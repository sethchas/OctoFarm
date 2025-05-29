// migrate-mongo-config.js
require('dotenv').config();

module.exports = {
  mongodb: {
    // use the exact same URL you set in .env (including the “/octofarm” db name)
    url: process.env.MONGO,
    // if your URL doesn’t include the DB name, you can set it here instead:
    // databaseName: 'octofarm',
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    }
  },

  // where your migrations live
  migrationsDir: 'migrations',

  // the collection in MongoDB that will track applied migrations
  changelogCollectionName: 'changelog',

  // optional: if you use a different extension
  // migrationFileExtension: '.js',
};
