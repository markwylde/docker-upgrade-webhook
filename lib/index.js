import createServer from "./createServer.js";

const server = await createServer(null);
server.listen(1907);
console.log('listening on', 1907);
