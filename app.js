const createError = require('http-errors');
const express = require('express');
const path = require('path');
const logger = require('morgan');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const connectEnsureLogin = require('connect-ensure-login');

const cron = require('node-cron');
const performDBCheck = require('./tasks/document-status_update');//script to send emails

const indexRouter = require('./routes/index');
const publicRouter = require('./routes/public');

const app = express();

// Set up mongoose connection
mongoose.set("strictQuery", false);

const dev_db_url =
    "mongodb+srv://docAdmin:docPassword@cluster0.zaexh0d.mongodb.net/doctrackbase1?retryWrites=true&w=majority";
const mongoDB = process.env.MONGODB_URI || dev_db_url;

main().catch((err) => console.log(err));
async function main() {
  await mongoose.connect(mongoDB);
}

// Set up method override.
const methodOverride = require("method-override");
app.use(methodOverride("_method"));

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// session initialization
app.use(session({
  secret: 'mataebunadaa',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 60 * 60 * 1000 } // 1 hour
}));

// Using the flash middleware provided by connect-flash to store messages in session
// and displaying in templates
const flash = require('connect-flash');
app.use(flash());

//Use passport middleware for authentication
app.use(passport.initialize());
app.use(passport.session());

const Owner = require('./models/owner');
passport.use(Owner.createStrategy());

passport.serializeUser(Owner.serializeUser());
passport.deserializeUser(Owner.deserializeUser());

//router routes
app.use('/', publicRouter);
app.use('/', connectEnsureLogin.ensureLoggedIn(), indexRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

// Schedule the script to run every hour (change the cron schedule as per your requirement)
cron.schedule("0 * * * *", () => {
    //performDBCheck();
    console.log("DB Check");
});

module.exports = app;
