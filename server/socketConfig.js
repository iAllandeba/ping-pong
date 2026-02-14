const socketIO = require('socket.io');

module.exports = (httpServer, corsOrigin = '*') => {
    return new socketIO.Server(httpServer, {
        cors: {
            origin: corsOrigin,
            methods: ['GET', 'POST'],
            transports: ['websocket', 'polling']
        }
    });
};