const express = require('express');
const router = express.Router();
const passport = require('passport');
const Owner = require('../models/owner');

const { body, validationResult } = require('express-validator');
const asyncHandler = require("express-async-handler");

// GET login page
router.get('/login', function(req, res, next) {
  res.render('login_form');
});

//POST login form with redirect
router.post('/login', passport.authenticate('local', { failureRedirect: '/' }),  function(req, res) {
  console.log(req.user);
  res.redirect('/');
});

// GET register page
router.get('/register', function(req, res, next) {
  res.render('register_form');
});

//POST register user and redirect to log in
router.post('/register', asyncHandler(async (req, res, next) => {
    console.log('registering user');
    Owner.register( new Owner({
        username: req.body.username,
        first_name: req.body.first_name,
        last_name: req.body.last_name,
        phone: req.body.phone,
        email: req.body.email,
    }), req.body.password, function(err) {
        if (err) {
            console.log('error while user register!', err);
            return next(err);
        }
        console.log('user registered!');
        res.redirect('/');
    });
})
);

//GET log out from app
router.get('/logout', function(req, res, next) {
    req.logout(function(err) {
        if (err) { return next(err); }
        res.redirect('/');
    });
});

module.exports = router;
