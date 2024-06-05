// This file will start the server and integrate Socket.IO and Kurento

// Getting server connections
const express = require("express");
const socketIO = require("socket.io");
const kurento = require("kurento-client");

let kurentoClient = null;
let iceCandidateQueues = {};

const app = express();
const PORT = process.env.PORT || 3000;

// Set up the Express app and middlewares to return an HTTP server
const server = app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

// Passing HTTP server to the socket to establish connection which socket.io does behind the scenes
const io = socketIO(server, {
  // overiding cors
  cors: {
    origin: "http://localhost:4000", // Allow requests from this origin
    methods: ["GET", "POST", "PUT", "DELETE"], // Allow these HTTP methods
    allowedHeaders: ["any custom headers to included in future"], // Allow these custom headers
    credentials: true, // Allow cookies to be sent
  },
});

let rooms = {};

//When a new client connects, the callback is executed with the socket object representing the connection.
io.on("connection", (socket) => {
  console.log("A client connected");

  // listening to messages sent from clients
  socket.on("message", (message) => {
    switch (message.event) {
      case "joinRoom":
        joinRoom(socket, message.userName, message.roomName, (err) =>
          err ? console.log(err) : null
        );
        break;
      case "recieveVideoFrom":
        recieveVideoFrom(
          socket,
          message.userId,
          message.roomName,
          message.sdpOffer,
          (err) => (err ? console.log(err) : null)
        );
        break;
      case "candidate":
        addIceCandidate(
          socket,
          message.userId,
          message.roomName,
          message.candidate,
          (err) => (err ? console.log(err) : null)
        );
        break;
    }
  });
});

// SOCKET CONNECTION FUNCTIONS:
function joinRoom(socket, userName, roomName, callback) {
  getRoom(socket, roomName, (error, myRoom) => {
    if (error) {
      return callback(error);
    }
    // now creating a webrtc endpoint in the pipeline of the r0oom
    myRoom.pipeline.create("WebRtcEndpoint", (error, webRtcEndpoint) => {
      if (error) {
        return callback(error);
      }
      let user = {
        id: socket.id,
        name: userName,
        // outgoingEndpoint which will be responsible for sending media to all the users thorugh the pipeline
        outgoingMedia: outgoingMedia,
        //
        incomingMedia: [],
      };

      // It may be possible that i receive an ice candidate before the user is added to the room or the endpoint is created
      let iceCandidateQueue = iceCandidateQueues[user.id];
      if (iceCandidateQueue) {
        while (iceCandidateQueue.length) {
          let ice = iceCandidateQueue.shift();
          user.outgoingMedia.addIceCandidate(ice.candidate);
        }
      }

      user.outgoingMedia.on("OnIceCandidate", (event) => {
        let candidate = kurento.register.complexTypes.IceCandidate(
          event.candidate
        );
        socket.emit("message", {
          event: "candidate",
          userId: user.id,
          candidate: candidate,
        });
      });

      // Everytime a new user joins the call we need to tell other uses about it
      socket.to(roomName).emit("message", {
        event: "newParticipantArrived",
        userId: user.id,
        userName: user.name,
      });

      // If a new user joins it must able to communicate with the endpoints in order to recieve the media from other users
      // lets get a list of exsisting users and send it back to new users
      let exsistingUsers = [];
      for (let i in myRoom.participants) {
        if (myRoom.participants[i].id === roomName) {
          exsistingUsers.push({
            id: myRoom.participants[i].id,
            name: myRoom.participants[i].name,
          });
        }
      }
      // Sending this list of users to new user
      socket.emit("message", {
        event: "exsistingParticipants",
        exsistingUsers: exsistingUsers,
        userId: user.id,
      });

      // Adding the new user to the participants array in backend
      participant[user.id] = user;
    });
  });
}

// Getting the kurento client to connect a media server so that pipline can be created that will be used to create endpoints and control how media flows between them
function getKurentoClient(callback) {
  if (kurentoClient !== null) {
    return callback(null, kurentoClient);
  }

  kurento("ws://localhost:8888/kurento", (error, _kurentoClient) => {
    if (error) {
      let message = "Could not find media server at address";
      return callback(message);
    }

    kurentoClient = _kurentoClient;
    callback(null, kurentoClient);
  });
}

// Creating a mediapipeline in the room if the room doesnt already exsists or joining the room if it already exsists
function getRoom(socket, roomName, callback) {
  let myRoom = io.sockets.adapter.rooms[roomName] || { length: 0 };
  let numClients = myRoom.length;

  if (numClients === 0) {
    // this socket.join creates a room which is stored in the rooms object in io.socket.adapter.rooms object with the help of roomName or roomId passed here
    socket.join(roomName, () => {
      myRoom = io.sockets.adapter.rooms[roomName];
      // creating a media pipeline in the room if the room doesnt already exsists
      // a media pipleline is a container for media elements(diff endpoints with diff purposes, ex webRTCendpoint, recordingEndpoint and other elements that can be confiugrd by the developer) in kurento
      getKurentoClient((error, kurento) => {
        kurento.create("MediaPipeline", (error, pipeline) => {
          myRoom.pipeline = pipeline;
          myRoom.participants = {};
          callback(null, myRoom);
        });
      });
    });
  } else {
    socket.join(roomName);
    callback(null, myRoom);
  }
}

// Creating webrtc endpoints inside the pipeline of the room and combining the differnt incoming media endpoints of the user(asker) into 1 endpoint
function getEndpointForUser(socket, roomName, senderId, callback) {
  let myRoom = io.sockets.adapter.rooms[roomName];
  let asker = myRoom.participants[socket.id];
  let sender = myRoom.participants[senderId];

  if (asker.id === sender.id) {
    return callback(null, asker.outgoingMedia);
  }

  // if the incoming media endpoint for the sender already exsists then connect the sender to the asker
  if (asker.incomingMedia[sender.id]) {
    sender.outgoingMedia.connect(asker.incomingMedia[sender.id], (error) => {
      if (error) {
        return callback(error);
      }
      callback(null, asker.incomingMedia[sender.id]);
    });
  }
  // else create a new incoming media endpoint for the sender and connect the sender to the asker
  else {
    // now creating a webrtc endpoint in the pipeline of the r0oom
    myRoom.pipeline.create("WebRtcEndpoint", (error, incoming) => {
      if (error) {
        return callback(error);
      }
      // creating the icnoming media endpoint to the array of asker
      asker.incomingMedia[sender.id] = incoming;

      // It may be possible that i receive an ice candidate before the user is added to the room or the endpoint is created
      let iceCandidateQueue = iceCandidateQueues[user.id];
      if (iceCandidateQueue) {
        while (iceCandidateQueue.length) {
          let ice = iceCandidateQueue.shift();
          user.incomingMedia.addIceCandidate(ice.candidate);
        }
      }

      user.incomingMedia.on("OnIceCandidate", (event) => {
        let candidate = kurento.register.complexTypes.IceCandidate(
          event.candidate
        );
        socket.emit("message", {
          event: "candidate",
          userId: user.id,
          candidate: candidate,
        });
      });

      sender.outgoingMedia.connect(incoming, (error) => {
        if (error) {
          return callback(error);
        }
        callback(null, incoming);
      });
    });
  }
}

// recieve videoFrom function is called when a new user joins the room and the user is ready to recieve the video from the other users
function recieveVideoFrom(socket, userId, roomName, sdpOffer, callback) {
  getEndpointForUser(socket, roomName, userId, (error, endpoint) => {
    if (error) {
      return callback(error);
    }
    endpoint.processOffer(sdpOffer, (error, sdpAnswer) => {
      if (error) {
        return callback(error);
      }
      socket.emit("message", {
        event: "recieveVideoAnswer",
        userId: userId,
        sdpAnswer: sdpAnswer,
      });
      endpoint.gatherCandidates((err) => {
        console.log(err);
      });
    });
  });
}

// addIceCandidate function is called when a new ice candidate is recieved from the user
function addIceCandidate(socket, userId, roomName, iceCandidate, callback) {
  let user = io.sockets.adapter.room[roomName].participants[socket.id];
  if (user) {
    let candidate = kurento.register.complexTypes.IceCandidate(iceCandidate);
    if (user.outgoingMedia) {
      user.outgoingMedia.addIceCandidate(iceCandidate);
    } else {
      iceCandidateQueues[user.id].push({ candidate: candidate });
    }
  } else {
    if (user.incomingMedia[senderId]) {
      user.incomingMedia[senderId].addIceCandidate(candidate);
    } else {
      if (!iceCandidateQueues[user.id]) {
        iceCandidateQueues[user.id] = [];
      }
      iceCandidateQueues[user.id].push({ candidate: candidate });
    }
  }
}
