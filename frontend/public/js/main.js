const socket = io.connect("http://localhost:3000"); // Adjust the URL as needed

// fields
let divRoomSelection = document.getElementById("roomSelection");
let divMeetingRoom = document.getElementById("meetingRoom");
let inputRoom = document.getElementById("roomName");
let inputName = document.getElementById("userName");

// varibles
let localStream;
let roomName = inputRoom.value;
let currUserName = inputName.value;
const participants = {};

document.getElementById("startButton").addEventListener("click", startCall);

function startCall() {
  console.log("Start call button clicked");

  const roomName = inputRoom.value;
  const userName = inputName.value;

  if (roomName === "" || userName === "") {
    alert("room and name is required");
  } else {
    // sending a join request to the socket
    let message = {
      event: "joinRoom",
      userName: userName,
      roomName: roomName,
    };
    sendMessage(message);
    divRoomSelection.style = "display:none";
  }
}

// listenning for different events(new participant , candidateIce , exsisting participant) from the socket:
// Listening Messages
socket.on("message", (message) => {
  console.log("message recieved", message);
  switch (message.event) {
    case "newParticipantArrived":
      recieveVideo(message.userId, message.userName);
      break;
    case "exsistingParticipants":
      onExsistingParticipants(message.userId, message.exsistingUsers);
      break;
    case "receiveVideoAnswer":
      onReceiveVideoAnswer(message.senderId, message.sdpAnswer);
    case "candidateIce":
      addIceCandidate(message.userId, message.candidate);
      break;
    default:
      console.log("default case");
  }
});

// Sending Messages
sendMessage = (message) => {
  console.log("sending message", message);
  socket.emit("message", message);
};

// Functions that Handles messages recieved from backend to client
// First managing 2 types of messages which are sent
// once the pipeline is set in the room ,if a new user has joined (message to others) and if a new user has joined (message to the new user)

// 1. new user arrived
function recieveVideo(userId, userName) {
  // Creating html video element to create space to display the new user
  let video = document.createElement("video");
  let div = document.createElemtent("div");
  let name = document.createElement("div");
  div.className = "videoContainer";
  video.id = userId;
  video.autoplay = true;
  div.appendChild(document.createTextNode(userName));
  div.appendChild(video);
  div.appendChild(name);
  divMeetingRoom.appendChild(div);

  // Creating new user object
  let user = {
    id: userId,
    userName: userName,
    video: video,
    rtcpeer: null,
  };

  // adding the new user in the participants array
  participants[user.id] = user;

  let options = {
    remoteVideo: video,
    onIceCandidate: onIceCandidate,

    // the function is defined below
  };
  // Configuring the peer connection capable of recieving media
  user.rtcpeer = kurentoUtils.WebRtcPeer.WebRtcPeerRecvonly(
    options,
    function (error) {
      if (error) {
        return console.error(error);
      }
      this.generateOffer(onOffer);
    }
  );

  // Defining onOffer and onIceCandidate as inner functions as they are a part of handling events when a new user joins
  let onOffer = (err, offer, additionalVar) => {
    let message = {
      event: "recieveVideoOffer",
      userId: user.id,
      roomName: roomName,
      sdfOffer: offer,
    };
    sendMessage(message);
  };

  let onIceCandidate = (candidate, additonalVar) => {
    let message = {
      event: "candidate",
      userId: user.id,
      roomName: roomName,
      candidate: candidate,
    };
    sendMessage(message);
  };
}
// 2. What happens to the user who is joining the room , who is sent the list of exsissitng participants,
// Changes :
// the endpoint will be send only
// we have to handle dislaying the remote streams which are already on the room

function onExsistingParticipants(userId, exsistingUsers) {
  // Creating html video element to create space to display the new user
  let video = document.createElement("video");
  let div = document.createElemtent("div");
  let name = document.createElement("div");
  div.className = "videoContainer";
  video.id = userId;
  video.autoplay = true;
  div.appendChild(document.createTextNode(currUserName));
  div.appendChild(video);
  div.appendChild(name);
  divMeetingRoom.appendChild(div);

  // Creating new user object
  let user = {
    id: userId,
    userName: currUserName,
    video: video,
    rtcpeer: null,
  };

  // adding the new user in the participants array
  participants[user.id] = user;

  let constraints = {
    audio: true,
    video: {
      mandatory: {
        maxWidth: 320,
        minFrameRate: 15,
        maxFrameRate: 15,
      },
    },
  };
  let options = {
    localVideo: video,
    onIceCandidate: onIceCandidate,
    mediaConstraints: constraints,
    // its function is defined below
  };
  // Configuring the peer connection capable of sending media
  user.rtcpeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendonly(
    options,
    function (error) {
      if (error) {
        return console.error(error);
      }
      this.generateOffer(onOffer);
    }
  );

  // getting the streams of other users on the remote server , this wil happen in the similar fashion as the users presetn on the server wil recieve the video of the new user which has joined
  exsistingUsers.forEach((user) => {
    recieveVideo(user.id, user.name);
  });

  // Defining onOffer and onIceCandidate as inner functions as they are a part of handling events when a new user joins
  let onOffer = (err, offer, additionalVar) => {
    let message = {
      event: "recieveVideoOffer",
      userId: user.id,
      roomName: roomName,
      sdfOffer: offer,
    };
    sendMessage(message);
  };

  let onIceCandidate = (candidate, additonalVar) => {
    let message = {
      event: "candidate",
      userId: user.id,
      roomName: roomName,
      candidate: candidate,
    };
    sendMessage(message);
  };
}

function onReceiveVideoAnswer(senderId, sdpAnswer) {
  participants[senderId].rtcpeer.processAnswer(sdpAnswer);
}

function addIceCandidate(userId, candidate) {
  participants[userId].rtcpeer.addIceCandidate(candidate);
}
