const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { makeTempDir, removeTempDir } = require('./tmp');

let memoryServer = null;
let memoryServerDir = null;
let connectionUri = null;
let dbName = null;

/**
 * Connects mongoose to a throwaway database: a mongodb-memory-server instance by default, or a
 * unique database on the server in MONGODB_TEST_URI when that variable is set. Waits until the
 * indexes of all registered models exist. Calling it again reconnects to the same database.
 */
async function startTestDb() {
  if (mongoose.connection.readyState === 1) return connectionUri;

  if (!connectionUri && process.env.MONGODB_TEST_URI) {
    connectionUri = process.env.MONGODB_TEST_URI;
    dbName = `docdatetrack_test_${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
  } else if (!connectionUri) {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    memoryServerDir = makeTempDir('mongodb-');
    memoryServer = await MongoMemoryServer.create({
      instance: { dbPath: memoryServerDir, args: ['--nounixsocket'] },
    });
    connectionUri = memoryServer.getUri();
    dbName = 'docdatetrack_test';
  }

  await mongoose.connect(connectionUri, { dbName });
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
  return connectionUri;
}

/** Empties every collection (indexes are kept). */
async function clearTestDb() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}

async function stopTestDb() {
  if (!memoryServer && mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
  }
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
  if (memoryServerDir) {
    removeTempDir(memoryServerDir);
    memoryServerDir = null;
  }
  connectionUri = null;
  dbName = null;
}

function getTestDbUri() {
  return connectionUri;
}

module.exports = { startTestDb, stopTestDb, clearTestDb, getTestDbUri };
