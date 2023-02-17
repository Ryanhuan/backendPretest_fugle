const express = require("express");
const axios = require("axios");
const WebSocket = require('ws');

const app = express();

const server = app.listen(3000, () => {
  console.log('API server is listening on port 3000');
});

const wsServer = new WebSocket.Server({ server, path: '/streaming' });

const ipLimit = 10;
const userLimit = 5;
const ipRequests = {};
const userRequests = {};

// 設定每個 currency pair 的最新價格
const latestPrices = {};

app.get("/data", async (req, res) => {
  const ip = req.ip;
  const user = req.query.user;

  if (!ipRequests[ip]) {
    ipRequests[ip] = { count: 0, timestamp: Date.now() };
  }

  if (!userRequests[user]) {
    userRequests[user] = { count: 0, timestamp: Date.now() };
  }

  const ipData = ipRequests[ip];
  const userData = userRequests[user];

  if (Date.now() - ipData.timestamp >= 60000) {
    ipData.count = 0;
    ipData.timestamp = Date.now();
  }

  if (Date.now() - userData.timestamp >= 60000) {
    userData.count = 0;
    userData.timestamp = Date.now();
  }

  ipData.count += 1;
  userData.count += 1;

  if (ipData.count > ipLimit || userData.count > userLimit) {
    res.status(200).json({ ip: ipData.count, user: userData.count });
  } else {
    try {
      const response = await axios.get(
        "https://hacker-news.firebaseio.com/v0/topstories.json?print=pretty"
      );
      console.log(ipRequests);

      res.json({ result: response.data, user });
    } catch (error) {
      res.status(500).send("Something went wrong!");
    }
  }
});


let allohlcData = {};

// calculate OHLC Data
function calculateOHLC(msg) {
  let { data, channel } = msg;
  let { timestamp, price, } = data;
  timestamp = Number(timestamp);
  ohlcData = allohlcData[channel];

  // console.log(msg);  
  if (ohlcData === undefined) {
    allohlcData[channel] = {
      timestamp: timestamp,
      openPrice: price,
      highPrice: price,
      lowPrice: price,
      closePrice: price,
    };
  }
  else if ((timestamp - ohlcData.timestamp) > 60) {
    ohlcData.timestamp = timestamp;
    ohlcData.openPrice = price;
    ohlcData.highPrice = Math.max(ohlcData.highPrice, price);
    ohlcData.lowPrice = Math.min(ohlcData.lowPrice, price);
    ohlcData.closePrice = price;
  }
  else {
    ohlcData.highPrice = Math.max(ohlcData.highPrice, price);
    ohlcData.lowPrice = Math.min(ohlcData.lowPrice, price);
    ohlcData.closePrice = price;
  }

}


const CURRENCY_PAIRS = ['btcusd', 'ethusd', 'xrpusd', 'bchusd', 'ltcusd', 'eosusd', 'bnbusd', 'adausd', 'xlmusd', 'xtzusd'];


wsServer.on('connection', (ws) => {
  console.log('wsServer connection');
  const wsClient = new WebSocket('wss://ws.bitstamp.net');

  //WebSocket
  wsClient.on('open', () => {
    console.log('WebSocket client connected to Bitstamp');
  });

  ws.on('message', (data) => {
    console.log('wsServer message');

    // console.log(JSON.parse(data));
    const { action } = JSON.parse(data);

    for (let ele of CURRENCY_PAIRS) {
      _channel = 'live_trades_' + ele;

      if (action === 'subscribe') {

        wsClient.send(JSON.stringify({
          event: 'bts:subscribe',
          data: {
            channel: _channel,
          },
        }));
      } else if (action === 'unsubscribe') {
        wsClient.send(JSON.stringify({
          event: 'bts:unsubscribe',
          data: {
            channel: _channel,
          },
        }));
      }

    }

  })


  // 監聽 WebSocket client 收到訊息事件
  wsClient.on('message', (data) => {
    const message = JSON.parse(data);
    // console.log('message', message);

    if (message.event === 'trade') {
      const { data, channel } = message;
      calculateOHLC(message);
      wsServer.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          let _ohlc = JSON.parse(JSON.stringify(allohlcData[channel]));
          delete _ohlc.timestamp;
          client.send(JSON.stringify({ channel: channel, price: data.price, ohlc: _ohlc }));
        }
      });
    }
  });


})


// TEST
var wsFactory = {
  tryCount: 3,
  connect: function (url) {
    var ctx = this,
      ws = new WebSocket(url);

    return new Promise(function (v, x) {
      ws.onerror = e => {
        console.log(`WS connection attempt ${4 - ctx.tryCount} -> Unsuccessful`);
        e.target.readyState === 3 && --ctx.tryCount;
        if (ctx.tryCount > 0) setTimeout(() => v(ctx.connect(url)), 1000);
        else x(new Error("3 unsuccessfull connection attempts"));
      };
      ws.onopen = e => {
        console.log(`WS connection Status: ${e.target.readyState}`);
        v(ws);
      };
      ws.onmessage = m => console.log(m.data);
    });
  }
};


wsFactory.connect("ws://localhost:3000/streaming")
  .then(ws => {
    setTimeout(() => {
      ws.send(JSON.stringify({ action: 'subscribe' }))
    }, 5000)

    setTimeout(() => {
      ws.send(JSON.stringify({ action: 'unsubscribe' }))
    }, 10000)

  })



