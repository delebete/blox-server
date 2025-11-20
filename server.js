const WebSocket = require('ws');

// Create server on the port Render provides (or 8080 locally)
const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: port });

console.log(`Blox Server started on port ${port}`);

// Game State
let players = {};
let world = {}; // Stores blocks placed by users

const generateId = () => Math.random().toString(36).substr(2, 9);

function broadcast(data, senderWs, includeSelf = false) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            if (includeSelf || client !== senderWs) {
                client.send(msg);
            }
        }
    });
}

// --- HEARTBEAT SYSTEM (Fixes Stuck Players) ---
// Checks every 30 seconds for dead connections
const interval = setInterval(function ping() {
    wss.clients.forEach(function each(ws) {
        if (ws.isAlive === false) {
            console.log(`Connection ${ws.connId} timed out.`);
            return ws.terminate(); // Force close, triggering the 'close' event below
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('connection', (ws) => {
    const connId = generateId();
    ws.connId = connId;
    ws.playerId = null; 
    ws.isAlive = true; // Mark alive on connect

    console.log(`Client connected: ${connId}`);

    ws.on('pong', () => {
        ws.isAlive = true; // Client responded to ping
    });

    // Send WELCOME packet
    ws.send(JSON.stringify({
        type: 'WELCOME',
        players: Object.values(players),
        world: Object.values(world)
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'PLAYER_UPDATE':
                    if (!ws.playerId) {
                        ws.playerId = data.id;
                        console.log(`Associated ${ws.connId} with Player ${data.id}`);
                    }
                    players[data.id] = data;
                    broadcast(data, ws, false);
                    break;

                case 'REQ_WORLD_CREATE':
                    const newId = generateId();
                    const newPart = { ...data.data, id: newId };
                    world[newId] = newPart;
                    broadcast({ type: 'WORLD_CREATE', data: newPart }, ws, true);
                    break;

                case 'REQ_WORLD_UPDATE':
                    if (world[data.id]) {
                        world[data.id] = { ...world[data.id], ...data.data };
                        broadcast({ type: 'WORLD_UPDATE', id: data.id, data: data.data }, ws, true);
                    }
                    break;

                case 'REQ_WORLD_DELETE':
                    if (world[data.id]) {
                        delete world[data.id];
                        broadcast({ type: 'WORLD_DELETE', id: data.id }, ws, true);
                    }
                    break;
            }
        } catch (e) {
            console.error("Error parsing message", e);
        }
    });

    ws.on('close', () => {
        console.log(`Client disconnected: ${ws.connId}`);
        if (ws.playerId && players[ws.playerId]) {
            console.log(`Removing player: ${ws.playerId}`);
            delete players[ws.playerId];
            // Broadcast to everyone else to remove this avatar
            broadcast({ type: 'PLAYER_LEAVE', id: ws.playerId }, ws, false);
        }
    });
});

wss.on('close', () => {
    clearInterval(interval);
});
