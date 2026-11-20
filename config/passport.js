const mongoose = require('mongoose');
const passport = require('passport');
const User = require('../models/user');

passport.use(User.createStrategy());

// Sessions store the user id (so a new account that reuses a username can never take over an
// old session) and the account's session version, which every password change increments.
passport.serializeUser((user, done) => done(null, { id: user.id, v: user.session_version ?? 0 }));

function isSessionUser(data) {
  return (
    data !== null &&
    typeof data === 'object' &&
    mongoose.isObjectIdOrHexString(data.id) &&
    Number.isInteger(data.v)
  );
}

// Sessions with an outdated version, or from older releases that stored only the id, are signed
// out.
passport.deserializeUser(async (data, done) => {
  try {
    const user = isSessionUser(data) ? await User.findById(data.id) : null;
    done(null, user && user.session_version === data.v ? user : false);
  } catch (error) {
    done(error);
  }
});

module.exports = passport;
