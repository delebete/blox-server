const WebSocket = require('ws');

const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: port });

console.log(`Blox Server started on port ${port}`);

// Game State
let players = {};
let world = {}; 

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

// Heartbeat
const interval = setInterval(function ping() {
    wss.clients.forEach(function each(ws) {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('connection', (ws) => {
    const connId = generateId();
    ws.connId = connId;
    ws.playerId = null; 
    ws.isAlive = true;

    console.log(`Client connected: ${connId}`);

    ws.on('pong', () => ws.isAlive = true);

    // Send WELCOME packet
    // We intentionally send the full players object which now includes attachments
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
                        // Initialize player state if new
                        if (!players[data.id]) {
                            players[data.id] = { ...data, attachments: {} };
                        }
                    }
                    
                    // CRITICAL FIX: Merge data, don't overwrite attachments
                    if (players[data.id]) {
                        players[data.id].x = data.x;
                        players[data.id].y = data.y;
                        players[data.id].z = data.z;
                        players[data.id].rot = data.rot;
                        players[data.id].name = data.name;
                    } else {
                        players[data.id] = { ...data, attachments: {} };
                    }
                    
                    broadcast(data, ws, false);
                    break;

                // --- WORLD LOGIC ---
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

                // --- AVATAR LOGIC ---
                case 'REQ_AVATAR_ATTACH':
                    if (ws.playerId && players[ws.playerId]) {
                        const attId = generateId();
                        const attachment = { ...data.data, id: attId };
                        
                        // Save to server state
                        if (!players[ws.playerId].attachments) players[ws.playerId].attachments = {};
                        players[ws.playerId].attachments[attId] = attachment;

                        // Broadcast to everyone (including sender to confirm ID)
                        broadcast({ 
                            type: 'AVATAR_ATTACH', 
                            playerId: ws.playerId, 
                            data: attachment 
                        }, ws, true);
                    }
                    break;

                case 'REQ_AVATAR_UPDATE':
                    if (ws.playerId && players[ws.playerId] && players[ws.playerId].attachments) {
                        const target = players[ws.playerId].attachments[data.attId];
                        if (target) {
                            // Merge updates
                            players[ws.playerId].attachments[data.attId] = { ...target, ...data.data };
                            broadcast({ 
                                type: 'AVATAR_UPDATE', 
                                playerId: ws.playerId, 
                                attId: data.attId, 
                                data: data.data 
                            }, ws, false); // Sender updated locally, no echo needed usually, but depends on implementation
                        }
                    }
                    break;

                case 'REQ_AVATAR_DELETE':
                    if (ws.playerId && players[ws.playerId] && players[ws.playerId].attachments) {
                        if (players[ws.playerId].attachments[data.attId]) {
                            delete players[ws.playerId].attachments[data.attId];
                            broadcast({ 
                                type: 'AVATAR_DELETE', 
                                playerId: ws.playerId, 
                                attId: data.attId 
                            }, ws, false);
                        }
                    }
                    break;
            }
        } catch (e) {
            console.error("Error parsing message", e);
        }
    });

    ws.on('close', () => {
        if (ws.playerId && players[ws.playerId]) {
            delete players[ws.playerId];
            broadcast({ type: 'PLAYER_LEAVE', id: ws.playerId }, ws, false);
        }
    });
});

wss.on('close', () => clearInterval(interval));
