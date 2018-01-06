'use strict';

const admin = require('firebase-admin');
const functions = require('firebase-functions'); // Cloud Functions for Firebase library
const DialogflowApp = require('actions-on-google').DialogflowApp; // Google Assistant helper library
const gcs = require('@google-cloud/storage')();
const spawn = require('child-process-promise').spawn;
const path = require('path');
const os = require('os');
const fs = require('fs');
const requestClient = require('request-promise');

const AipSpeechClient = require("baidu-aip-sdk").speech;

// 设置APPID/AK/SK
var APP_ID = functions.config().baidu.app_id;
var API_KEY = functions.config().baidu.api_key;
var SECRET_KEY = functions.config().baidu.secret_key;

var app = admin.initializeApp(functions.config().firebase);
var db = admin.firestore();

exports.addMessage = functions.https.onRequest((request, response) => {
  console.log(admin.storage().bucket().name);
  console.log('Dialogflow Request headers: ' + JSON.stringify(request.headers));
  console.log('Dialogflow Request body: ' + JSON.stringify(request.body));
  if (request.body.queryResult) {
    processV2Request(request, response);
  } else {
    console.log('Invalid Request');
    return response.status(400).end('Invalid Webhook Request (expecting v1 or v2 webhook request)');
  }
});

exports.createNews = functions.firestore
  .document('readhub/{id}')
  .onCreate(event => {
    var newValue = event.data.data();
    var summary = newValue.summary;
    var fileName = newValue.id + '.mp3';
    var client = new AipSpeechClient(APP_ID, API_KEY, SECRET_KEY);
    // 语音合成, 附带可选参数
    var options = {
      spd: 6,
      per: 0
    };
    return client.text2audio(summary, options).then(function (result) {
      console.log('step1-------------------');
      if (result.data) {
        const tempFilePath = path.join(os.tmpdir(), fileName);
        fs.writeFileSync(tempFilePath, result.data);
        const metadata = {
          contentType: 'audio/mp3'
        };
        var bucket = admin.storage().bucket();
        bucket.upload(tempFilePath, {
          destination: fileName,
          metadata: metadata
        }, function (err, file) {
          if (!err) {
            // "zebra.jpg" is now in your bucket.
            console.log(file);
          } else {
            console.log(err);
            var deleteDoc = db.collection('readhub').doc(newValue.id).delete();
            console.log(deleteDoc);
          }
          fs.unlinkSync(tempFilePath);
        });

      } else {
        // 服务发生错误
        console.log(result)
        var deleteDoc = db.collection('readhub').doc(newValue.id).delete();
        console.log(deleteDoc);
      }
    }, function (e) {
      // 发生网络错误
      console.log(e)
      var deleteDoc = db.collection('readhub').doc(newValue.id).delete();
      console.log(deleteDoc);
    });
  });

/*
 * Function to handle v2 webhook requests from Dialogflow
 */
function processV2Request(request, response) {
  // An action is a string used to identify what needs to be done in fulfillment
  let action = (request.body.queryResult.action) ? request.body.queryResult.action : 'default';
  // Parameters are any entites that Dialogflow has extracted from the request.
  let parameters = request.body.queryResult.parameters || {}; // https://dialogflow.com/docs/actions-and-parameters
  // Contexts are objects used to track and store conversation state
  let inputContexts = request.body.queryResult.outputContexts; // https://dialogflow.com/docs/contexts
  // Get the request source (Google Assistant, Slack, API, etc)
  let requestSource = (request.body.originalDetectIntentRequest) ? request.body.originalDetectIntentRequest.source : undefined;
  // Get the session ID to differentiate calls from different users
  let session = (request.body.session) ? request.body.session : undefined;

  console.log(parameters);
  console.log(inputContexts);

  // Create handlers for Dialogflow actions as well as a 'default' handler
  const actionHandlers = {
    // The default welcome intent has been matched, welcome the user (https://dialogflow.com/docs/events#default_welcome_intent)
    'input.welcome': () => {
      sendResponse('Hello, Welcome to news agent!'); // Send simple response to user
    },
    'input.news': () => {

      var newsRef = db.collection('readhub');
      var lastThree = newsRef.orderBy('order', 'desc').limit(10).get()
        .then(snapshot => {
          var responseBody = [{
            'platform': 'ACTIONS_ON_GOOGLE',
            'simple_responses': {
              'simple_responses': [{
                'ssml': "",
                'display_text': "today\'s news from readhub"
              }]
            }
          }];
          var responseArray = '';
          var lastOrder=0;
          snapshot.forEach(doc => {
            console.log(doc.id, '=>', doc.data());
            var ssml = "<audio src = '" + doc.data().mp3 + "' />";
            responseArray = responseArray + ssml + '<break time="2000ms"/>';
            lastOrder = doc.data().order;
          });
          console.log(responseArray);
          responseBody[0]['simple_responses']['simple_responses'][0]['ssml'] = '<speak>'+responseArray+'</speak>';
          let responseToUser = {
            fulfillmentMessages: responseBody,
            outputContexts: [{ 'name': `${session}/contexts/news`, 'lifespanCount': 2, 'parameters': {'order': lastOrder} }]
          };
          sendResponse(responseToUser);
        })
        .catch(err => {
          console.log('Error getting documents', err);
          sendResponse('I\'m having trouble, can you try that again?');
        });

    },
    'news.news-more': () => {
      var newsRef = db.collection('readhub');
      var lastOrder = inputContexts.find(element => element.name === `${session}/contexts/news`);
      console.log(lastOrder);
      var lastThree = newsRef.orderBy('order', 'desc').where('order', '<', lastOrder.parameters['order']).limit(10).get()
        .then(snapshot => {
          var responseBody = [{
            'platform': 'ACTIONS_ON_GOOGLE',
            'simple_responses': {
              'simple_responses': [{
                'ssml': "",
                'display_text': "more news from readhub"
              }]
            }
          }];
          var responseArray = '';
          var lastOrder=0;
          snapshot.forEach(doc => {
            console.log(doc.id, '=>', doc.data());
            var ssml = "<audio src = '" + doc.data().mp3 + "' />";
            responseArray = responseArray + ssml + '<break time="2000ms"/>';
            lastOrder = doc.data().order;
          });
          console.log(responseArray);
          if(responseArray == ''){
            responseArray = 'no more news now';
          }
          responseBody[0]['simple_responses']['simple_responses'][0]['ssml'] = '<speak>'+responseArray+'</speak>';
          let responseToUser = {
            fulfillmentMessages: responseBody,
            outputContexts: [{ 'name': `${session}/contexts/news`, 'lifespanCount': 2, 'parameters': {'order': lastOrder} }]
          };
          sendResponse(responseToUser);
        })
        .catch(err => {
          console.log('Error getting documents', err);
          sendResponse('I\'m having trouble, can you try that again?');
        });

    },
    'input.update': () => {
      return requestClient({
          url: 'https://api.readhub.me/topic?lastCursor=&pageSize=10',
          json: true
        }).then(function (body) {
          var batch = db.batch();
          for (var i = 0; i < body.data.length; i++) {
            var docRef = db.collection('readhub').doc(body.data[i].id);
            console.log(body.data[i].title);
            batch.set(docRef, {
              'id': body.data[i].id,
              'order': body.data[i].order,
              'title': body.data[i].title,
              'summary': body.data[i].summary,
              'updatedAt': body.data[i].updatedAt,
              'mp3': 'https://firebasestorage.googleapis.com/v0/b/'+ admin.storage().bucket() +'/o/' + body.data[i].id + '.mp3?alt=media'
            });
          }
          return batch.commit().then(function () {
            console.log('batch success');
            sendResponse('finished, try today\'s news');
          });
        })
        .catch(function (err) {
          console.log(err);
          sendResponse('I\'m having trouble, can you try that again?');
        });
    },
    'input.weather': () => {
      sendResponse('get weather');
    },
    // The default fallback intent has been matched, try to recover (https://dialogflow.com/docs/intents#fallback_intents)
    'input.unknown': () => {
      // Use the Actions on Google lib to respond to Google requests; for other requests use JSON
      sendResponse('I\'m having trouble, can you try that again?'); // Send simple response to user
    },
    // Default handler for unknown or undefined actions
    'default': () => {
      let responseToUser = {
        //fulfillmentMessages: richResponsesV2, // Optional, uncomment to enable
        //outputContexts: [{ 'name': `${session}/contexts/weather`, 'lifespanCount': 2, 'parameters': {'city': 'Rome'} }], // Optional, uncomment to enable
        fulfillmentText: 'This is from Dialogflow\'s Cloud Functions for Firebase editor! :-)' // displayed response
      };
      sendResponse(responseToUser);
    }
  };
  // If undefined or unknown action use the default handler
  if (!actionHandlers[action]) {
    action = 'default';
  }
  // Run the proper handler function to handle the request from Dialogflow
  actionHandlers[action]();
  // Function to send correctly formatted responses to Dialogflow which are then sent to the user
  function sendResponse(responseToUser) {
    // if the response is a string send it as a response to the user
    if (typeof responseToUser === 'string') {
      let responseJson = {
        fulfillmentText: responseToUser
      }; // displayed response
      response.json(responseJson); // Send response to Dialogflow
    } else {
      // If the response to the user includes rich responses or contexts send them to Dialogflow
      let responseJson = {};
      // Define the text response
      responseJson.fulfillmentText = responseToUser.fulfillmentText;
      // Optional: add rich messages for integrations (https://dialogflow.com/docs/rich-messages)
      if (responseToUser.fulfillmentMessages) {
        responseJson.fulfillmentMessages = responseToUser.fulfillmentMessages;
      }
      // Optional: add contexts (https://dialogflow.com/docs/contexts)
      if (responseToUser.outputContexts) {
        responseJson.outputContexts = responseToUser.outputContexts;
      }
      // Send the response to Dialogflow
      console.log('Response to Dialogflow: ' + JSON.stringify(responseJson));
      response.json(responseJson);
    }
  }
}
const richResponseV2Card = {
  'title': 'Title: this is a title',
  'subtitle': 'This is an subtitle.  Text can include unicode characters including emoji 📱.',
  'imageUri': 'https://developers.google.com/actions/images/badges/XPM_BADGING_GoogleAssistant_VER.png',
  'buttons': [{
    'text': 'This is a button',
    'postback': 'https://assistant.google.com/'
  }]
};
const audioResponsesV2 = [{
    'platform': 'ACTIONS_ON_GOOGLE',
    'simple_responses': {
      'simple_responses': [{
        'text_to_speech': 'webhook',
        "ssml": "<speak>webhook <audio src = 'https://actions.google.com/sounds/v1/water/humidifier_bubble.ogg' />, what’s the animal? </speak>",
        'display_text': 'webhook'
      }]
    }
  },
  {
    'platform': 'ACTIONS_ON_GOOGLE',
    'simple_responses': {
      'simple_responses': [{
        'text_to_speech': 'hell world',
        "ssml": "<speak>hell world <audio src = 'https://actions.google.com/sounds/v1/water/humidifier_bubble.ogg' />, what’s the animal? </speak>",
        'display_text': 'hell world'
      }]
    }
  }
];
const richResponsesV2 = [{
    'platform': 'ACTIONS_ON_GOOGLE',
    'simple_responses': {
      'simple_responses': [{
        'text_to_speech': 'Spoken simple response',
        'display_text': 'Displayed simple response'
      }]
    }
  },
  {
    'platform': 'ACTIONS_ON_GOOGLE',
    'basic_card': {
      'title': 'Title: this is a title',
      'subtitle': 'This is an subtitle.',
      'formatted_text': 'Body text can include unicode characters including emoji 📱.',
      'image': {
        'image_uri': 'https://developers.google.com/actions/images/badges/XPM_BADGING_GoogleAssistant_VER.png'
      },
      'buttons': [{
        'title': 'This is a button',
        'open_uri_action': {
          'uri': 'https://assistant.google.com/'
        }
      }]
    }
  },
  {
    'platform': 'FACEBOOK',
    'card': richResponseV2Card
  },
  {
    'platform': 'SLACK',
    'card': richResponseV2Card
  }
];