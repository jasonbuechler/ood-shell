var fs        = require('fs');
var http      = require('http');
var path      = require('path');
var WebSocket = require('ws');
var express   = require('express');
var pty       = require('node-pty');
var hbs       = require('hbs');
var dotenv    = require('dotenv');
var port      = 3000;
var uuidv4    = require('uuid/v4');
var uuid;

// Read in environment variables
dotenv.config({path: '.env.local'});
if (process.env.NODE_ENV === 'production') {
  dotenv.config({path: '/etc/ood/config/apps/shell/env'});
}

// Keep app backwards compatible
if (fs.existsSync('.env')) {
  console.warn('[DEPRECATION] The file \'.env\' is being deprecated. Please move this file to \'/etc/ood/config/apps/shell/env\'.');
  dotenv.config({path: '.env'});
}

//Create terminals object
var terminals = {
  instances: {

  },

  create: function() {
      var host = process.env.DEFAULT_SSHHOST || 'localhost';
      var dir;
      var term;
      var cmd, args;
      
      uuid = uuidv4();
      cmd = 'ssh';
      args = dir ? [host, '-t', 'cd \'' + dir.replace(/\'/g, "'\\''") + '\' ; exec ${SHELL} -l'] : [host];

      this.instances[uuid] = pty.spawn(cmd, args, {
        name: 'xterm-256color',
        cols: 80,
        rows: 30
      });

      return uuid;
  },

  exists: function() {
    if (uuid in this.instances) {
      return true;
    } else {
      return false;
    }
  },

  get: function(uuid) {
    return this.instances[uuid];
  },

  attach: function(uuid, ws) {
    var term = this.get(uuid);

    console.log('Opened terminal: ' + term.pid);

    term.on('data', function (data) {
      ws.send(data, function (error) {
        if (error) console.log('Send error: ' + error.message);
      });
    });

    term.on('error', function (error) {
      ws.close();
    });

    term.on('close', function () {
      ws.close();
    });

    ws.on('message', function (msg) {
      msg = JSON.parse(msg);
      if (msg.input)  term.write(msg.input);
      if (msg.resize) term.resize(parseInt(msg.resize.cols), parseInt(msg.resize.rows));
    });

    ws.on('close', function () {
      term.end();
      console.log('Closed terminal: ' + term.pid);
    });

  }
}

// Create all your routes
var router = express.Router();
router.get('/', function (req, res) {
  res.redirect(req.baseUrl + '/ssh');
});
router.get('/ssh*', function (req, res) {
  res.render('index', { baseURI: req.baseUrl });
});
router.use(express.static(path.join(__dirname, 'public')));

// Setup app
var app = express();

// Setup template engine
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// Mount the routes at the base URI
app.use(process.env.PASSENGER_BASE_URI || '/', router);

// Setup websocket server
var server = new http.createServer(app);
var wss = new WebSocket.Server({ server: server });

wss.on('connection', function connection (ws) {
  var match;


  console.log('Connection established');

  // Determine host and dir from request URL
  if (match = ws.upgradeReq.url.match(process.env.PASSENGER_BASE_URI + '/ssh/([^\\/]+)(.+)?$')) {
    if (match[1] !== 'default') host = match[1];
    if (match[2]) dir = decodeURIComponent(match[2]);
  }

  if (terminals.exists() === false) {
    terminals.create();
  }
  
  terminals.attach(uuid, ws);

});

server.listen(port, function () {
  console.log('Listening on ' + port);
});
