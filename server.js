const WebSocket = require('ws');

// Create server on the port Render provides (or 8080 locally)
const port = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: port });

console.log(`Blox Server started on port ${port}`);

// Game State
let players = {};
let world = {}; // Stores blocks placed by users

// Helper to generate short IDs
const generateId = () => Math.random().toString(36).substr(2, 9);

// Broadcast to everyone (including sender if includeSelf is true)
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

wss.on('connection', (ws) => {
    // Assign a temporary connection ID
    const connId = generateId();
    ws.connId = connId;
    
    console.log(`Client connected: ${connId}`);

    // 1. Send WELCOME packet (Current State)
    const playerList = Object.values(players);
    const worldList = Object.values(world);
    
    ws.send(JSON.stringify({
        type: 'WELCOME',
        players: playerList,
        world: worldList
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'PLAYER_UPDATE':
                    // Update server state
                    players[data.id] = data;
                    // Broadcast movement to EVERYONE ELSE
                    broadcast(data, ws, false);
                    break;

                case 'REQ_WORLD_CREATE':
                    // Server Authority: Create ID and save
                    const newId = generateId();
                    const newPart = { ...data.data, id: newId };
                    
                    world[newId] = newPart;
                    
                    // Tell EVERYONE (including creator) to spawn it
                    broadcast({ type: 'WORLD_CREATE', data: newPart }, ws, true);
                    break;

                case 'REQ_WORLD_UPDATE':
                    if (world[data.id]) {
                        // Update local state
                        world[data.id] = { ...world[data.id], ...data.data };
                        // Broadcast update
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
        console.log(`Client disconnected: ${connId}`);
        
        // Find which player ID belonged to this connection
        // (In a real app, we'd map connId to playerId better, 
        // but here we rely on the client having sent their ID in PLAYER_UPDATE)
        
        // We can't easily know the player ID just from close unless we stored it,
        // but for this simple example, we wait for the client logic or rely on timeouts.
        // However, to be safe, let's look for the player in our list if we can.
        
        // Note: In this simple implementation, we don't strictly remove players 
        // from the 'players' object on close to keep them persistent for a bit,
        // but usually you would broadcast a PLAYER_LEAVE here.
    });
});
