module.exports = function(app) {

    var Response = require('../lib/httpResponse.js');
    var User = require('mongoose').model('User');
    var acl = require('../lib/auth').acl;
    var jwtRefreshSecret = require('../lib/auth').jwtRefreshSecret
    var jwt = require('jsonwebtoken')
    var _ = require('lodash')
    var passwordpolicy = require('../lib/passwordpolicy')
	
    // Check token validity
    app.get("/api/users/checktoken", acl.hasPermission('validtoken'), function(req, res) {
        // #swagger.tags = ['User']

        Response.Ok(res, req.cookies['token']);
    });

    // Refresh token
    app.get("/api/users/refreshtoken", function(req, res) {
        // #swagger.tags = ['User']

        var userAgent = req.headers['user-agent']
        var token = req.cookies['refreshToken']
        
        User.updateRefreshToken(token, userAgent)
        .then(msg => {
            res.cookie('token', `JWT ${msg.token}`, {secure: true, sameSite: 'strict', httpOnly: true})
            res.cookie('refreshToken', msg.refreshToken, {secure: true, httpOnly: true, sameSite: 'strict', path: '/api/users/refreshtoken'})
            Response.Ok(res, msg)
        })
        .catch(err => {
            if (err.fn === 'Unauthorized') {
                res.clearCookie('token')
                res.clearCookie('refreshToken')
            }
            Response.Internal(res, err)
        })
    });

    // Remove token cookie
    app.delete("/api/users/refreshtoken", function(req, res) {
        // #swagger.tags = ['User']

        var token = req.cookies['refreshToken']
        try {
            var decoded = jwt.verify(token, jwtRefreshSecret)
        }
        catch (err) {
            res.clearCookie('token')
            res.clearCookie('refreshToken')
            if (err.name === 'TokenExpiredError')
                Response.Unauthorized(res, 'Expired refreshToken')
            else
                Response.Unauthorized(res, 'Invalid refreshToken')
            return
        }
        User.removeSession(decoded.userId, decoded.sessionId)
        .then(msg => {
            res.clearCookie('token')
            res.clearCookie('refreshToken')
            Response.Ok(res, msg)
        })
        .catch(err => Response.Internal(res, err))
    });

    // Authenticate user -> return JWT token
    app.post("/api/users/token", function(req, res) {
        // #swagger.tags = ['User']

        if (!req.body.password || !req.body.username) {
            Response.BadParameters(res, 'Required parameters: username, password');
            return;
        }

        // Validate types
        if (typeof req.body.password !== "string" || 
            typeof req.body.username !== "string" ||
            (req.body.totpToken && typeof req.body.totpToken !== "string")) {
            Response.BadParameters(res, 'Parameters must be of type String');
            return;
        }

        var user = new User();
        //Required params
        user.username = req.body.username;
        user.password = req.body.password;

        //Optional params
        if (req.body.totpToken) user.totpToken = req.body.totpToken;

        user.getToken(req.headers['user-agent'])
        .then(msg => {
            res.cookie('token', `JWT ${msg.token}`, {secure: true, sameSite: 'strict', httpOnly: true})
            res.cookie('refreshToken', msg.refreshToken, {secure: true, sameSite: 'strict', httpOnly: true, path: '/api/users/refreshtoken'})
            Response.Ok(res, msg)
        })
        .catch(err => Response.Internal(res, err))
    });

    // Check if there are any existing users for creating first user
    app.get("/api/users/init", function(req, res) {
        // #swagger.tags = ['User']

        User.getAll()
        .then(msg => Response.Ok(res, msg.length === 0))
        .catch(err => Response.Internal(res, err))
    });

    // Get all users
    app.get("/api/users", acl.hasPermission('users:read'), function(req, res) {
        // #swagger.tags = ['User']

        User.getAll()
        .then(msg => Response.Ok(res, msg))
        .catch(err => Response.Internal(res, err))
    });
    
    // Get users for export
    app.get("/api/users/export", acl.hasPermission('users:read-all'), function(req, res) {
        // #swagger.tags = ['User']

        User.export()
        .then(msg => Response.Ok(res, msg))
        .catch(err => Response.Internal(res, err))
    });

    // Get all reviewers
    app.get("/api/users/reviewers", acl.hasPermission('users:read'), function(req, res) {
        // #swagger.tags = ['User']

        User.getAll()
        .then((users) => {
            var reviewers = [];
            users.forEach(user => {
                if (acl.isAllowed(user.role, 'audits:review') || acl.isAllowed(user.role, 'audits:review-all')) {
                    reviewers.push(user);
                }
            })
            Response.Ok(res, reviewers);
        })
        .catch(err => Response.Internal(res, err))
    });

    // Get user self
    app.get("/api/users/me", acl.hasPermission('validtoken'), function(req, res) {
        // #swagger.tags = ['User']

        User.getByUsername(req.decodedToken.username)
        .then(msg => Response.Ok(res, msg))
        .catch(err => Response.Internal(res, err))
    });

    //get TOTP Qrcode URL
    app.get("/api/users/totp", acl.hasPermission('validtoken'), function(req, res) {
        // #swagger.tags = ['User']

        User.getTotpQrcode(req.decodedToken.username)
        .then(msg => Response.Ok(res, msg))
        .catch(err => Response.Internal(res, err))
    });

    //setup TOTP
    app.post("/api/users/totp", acl.hasPermission('validtoken'), function(req, res) {
        // #swagger.tags = ['User']

        if (!req.body.totpToken || !req.body.totpSecret) {
            Response.BadParameters(res, 'Missing some required parameters');
            return;
        }

        User.setupTotp(req.body.totpToken, req.body.totpSecret, req.decodedToken.username)
        .then(msg => Response.Ok(res, msg))
        .catch(err => Response.Internal(res, err))
    });

    //cancel TOTP
    app.delete("/api/users/totp", acl.hasPermission('validtoken'), function(req, res) {
        // #swagger.tags = ['User']

        if (!req.body.totpToken) {
            Response.BadParameters(res, 'Missing some required parameters');
            return;
        }

        User.cancelTotp(req.body.totpToken, req.decodedToken.username)
        .then(msg => Response.Ok(res, msg))
        .catch(err => Response.Internal(res, err))
    });

    // Get user by username
    app.get("/api/users/:username", acl.hasPermission('users:read'), function(req, res) {
        // #swagger.tags = ['User']

        User.getByUsername(req.params.username)
        .then(msg => Response.Ok(res, msg))
        .catch(err => Response.Internal(res, err))
    });

    // Create users (array of users)
    app.post("/api/users", acl.hasPermission('users:create'), function(req, res) {
        // #swagger.tags = ['User']

        var users = [];
        for (var i=0; i< req.body.length;i++) {
            var usr = req.body[i]
                
            if (!usr.username || !usr.password || !usr.firstname || !usr.lastname) {
                Response.BadParameters(res, 'Missing some required parameters');
                return;
            }
            if (passwordpolicy.strongPassword(usr.password)!==true){
                Response.BadParameters(res, 'Password does not match the password policy');
                return;
            }

            var user = {};
            //Required params
            user.username = usr.username;
            user.password = usr.password;
            user.firstname = usr.firstname;
            user.lastname = usr.lastname;

            //Optionals params
            user.role = usr.role || 'user';
            if (usr.email) user.email = usr.email;
            if (usr.phone) user.phone = usr.phone;
            users.push(user)
        }

        User.create(users)
        .then(msg => Response.Created(res, msg))
        .catch(err => Response.Internal(res, err))
    });

    // Create First User
    app.post("/api/users/init", function(req, res) {
        // #swagger.tags = ['User']

        if (!req.body.username || !req.body.password || !req.body.firstname || !req.body.lastname) {
            Response.BadParameters(res, 'Missing some required parameters');
            return;
        }
        if (passwordpolicy.strongPassword(req.body.password)!==true){
            Response.BadParameters(res, 'Password does not match the password policy');
            return;
        }
        var user = {};
        //Required params
        user.username = req.body.username;
        user.password = req.body.password;
        user.firstname = req.body.firstname;
        user.lastname = req.body.lastname;
        user.role = 'admin';

        User.getAll()
        .then(users => {
            if (users.length === 0)
                User.create([user])
                .then(msg => {
                    var newUser = new User();
                    //Required params
                    newUser.username = req.body.username;
                    newUser.password = req.body.password;

                    newUser.getToken(req.headers['user-agent'])
                    .then(msg => {
                        res.cookie('token', `JWT ${msg.token}`, {secure: true, sameSite: 'strict', httpOnly: true})
                        res.cookie('refreshToken', msg.refreshToken, {secure: true, sameSite: 'strict', httpOnly: true, path: '/api/users/refreshtoken'})
                        Response.Created(res, msg)
                    })
                    .catch(err => Response.Internal(res, err))
                })
                .catch((err) => Response.Internal(res, err))
            else
                Response.Forbidden(res, 'Already Initialized');
        })        
        .catch(err => Response.Internal(res, err))
    });

    // Update my profile
    app.put("/api/users/me", acl.hasPermission('validtoken'), function(req, res) {
        // #swagger.tags = ['User']

        if (!req.body.currentPassword ||
            (req.body.newPassword && !req.body.confirmPassword) ||
            (req.body.confirmPassword && !req.body.newPassword)) {
            Response.BadParameters(res, 'Missing some required parameters');
            return;
        }
        if (req.body.newPassword && req.body.newPassword.length==0 && passwordpolicy.strongPassword(req.body.newPassword)!==true){
            Response.BadParameters(res, 'New Password does not match the password policy');
            return;
        }
        if (req.body.newPassword && req.body.newPassword !== req.body.confirmPassword) {
            Response.BadParameters(res, 'New password validation failed');
            return;
        }

        var user = {};
        // Required params
        
        user.password = req.body.currentPassword;

        // Optionals params
        if (req.body.username) user.username = req.body.username;
        if (!_.isNil(req.body.newPassword)) user.newPassword = req.body.newPassword;
        if (req.body.firstname) user.firstname = req.body.firstname;
        if (req.body.lastname) user.lastname = req.body.lastname;
        if (!_.isNil(req.body.email)) user.email = req.body.email;
        if (!_.isNil(req.body.phone)) user.phone = req.body.phone;

        User.updateProfile(req.decodedToken.username, user)
        .then(msg => {
            res.cookie('token', msg.token, {secure: true, sameSite: 'strict', httpOnly: true})
            Response.Ok(res, msg)
        })
        .catch(err => Response.Internal(res, err))
    });

    // Update any user (admin only)
    app.put("/api/users/:id", acl.hasPermission('users:update'), function(req, res) {
        // #swagger.tags = ['User']

        if (req.body.password && !passwordpolicy.strongPassword(req.body.password)){
            Response.BadParameters(res, 'New Password does not match the password policy');
            return;
        }
        var user = {};
    
        // Optionals params
        if (req.body.username) user.username = req.body.username;
        if (!_.isNil(req.body.password)) user.password = req.body.password;
        if (req.body.firstname) user.firstname = req.body.firstname;
        if (req.body.lastname) user.lastname = req.body.lastname;
        if (!_.isNil(req.body.email)) user.email = req.body.email;
        if (!_.isNil(req.body.phone)) user.phone = req.body.phone;
        if (req.body.role) user.role = req.body.role;
        if (typeof(req.body.totpEnabled) === 'boolean') user.totpEnabled = req.body.totpEnabled;
        if (typeof(req.body.enabled) === 'boolean') user.enabled = req.body.enabled;

        User.updateUser(req.params.id, user)
        .then(msg => Response.Ok(res, msg))
        .catch(err => Response.Internal(res, err))
    });

    // Delete any user (admin only)
    /** Removed to keep linked references to user, disable user only for now
    app.delete("/api/users/:id", acl.hasPermission('users:delete'), function(req, res) {
        User.deleteOne({_id: req.params.id})
        .then(msg => {
            if (msg.n === 0)
                throw ({fn: 'NotFound', message: 'User not found'});
            else
                Response.Ok(res, 'User deleted successfully');
        })
        .catch(err => Response.Internal(res, err))
    });
    app.delete("/api/users", acl.hasPermission('users:delete'), function(req, res) {
        User.deleteAll()
        .then(msg => Response.Ok(res, msg))
        .catch(err => Response.Internal(res, err))
    });
     */
}
