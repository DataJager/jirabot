//Begin Global Variables
//Variable to hold the JIRA Website in case it changes
var jiraWebsite = "https://jira.libredigital.com/";
var botname = "jirabot";
var character_limit = 280;
//LookupTable for ProjectKeys
const pidTable = {
  'AP':11050,
  'BLU':10144,
  'CDT':10120,
  'DOPS':10450,
  'HRV':10750
}
//LookupTable for issue Types
const issueTypeTable = {
  'bug':1,
  'new feature':2,
  'improvement':4,
  'sub-task': 5,
  'epic': 6,
  'story': 7,
  'task': 8,
  'services ticket': 12,
  'defect': 15,
  'test': 10000,
}
//List of fields/items to get from each ticket
//Columns:
//1: Description of variable
//2: variable name
//3: Error message (if variable is null)
//4: Continue on Error (True/False)
//  [Descriptor(string),objectname,messageIfNull(string),printDescriptorWhenValueIsNull(boolean)]
// Right now, printIfnull is not used, it would be good make Acceptance Criteria not print if null
var items = [
  ["Summary",       'issue.fields.summary',             'No Summary Given',     true],
  ["Description",   'issue.fields.description',         '',                     false],
  ["Last Updated",  'issue.fields.updated',             'Never Updated',        true],
  ["Creator",       'issue.fields.creator.displayName', 'No Creator?',          true],
  ['Status',        'issue.fields.status.name',         'No Status',            true],
  ['Assigned to' ,  'issue.fields.assignee.displayName','Unassigned',           true],
  ['Acceptance Criteria', 'issue.fields.customfield_10051', '',                false],
];
//End Global Variables
//Logging setup
const log4js = require('log4js');
log4js.configure({
  appenders: { log: { type: 'file', filename: 'jirabot.log' } },
  categories: { default: { appenders: ['log'], level: 'info' } }
});
const logger = log4js.getLogger('log');

//Runs when bot is installed
function onInstallation(bot, installer) {
    if (installer) {
        bot.startPrivateConversation({user: installer}, function (err, convo) {
            if (err) {
                logger.error(err);
            } else {
                convo.say('I am a bot that has just joined your team');
                convo.say('You must now /invite me to a channel so that I can be of use!');
            }
        });
    }
}

//End Global Variables

//Configure the persistence options
var config = {};
if (process.env.MONGOLAB_URI) {
    var BotkitStorage = require('botkit-storage-mongo');
    config = {
        storage: BotkitStorage({mongoUri: process.env.MONGOLAB_URI}),
    };
} else {
    config = {
        json_file_store: ((process.env.TOKEN)?'./db_slack_bot_ci/':'./db_slack_bot_a/'), //use a different name if an app or CI
    };
}

//Are being run as an app or a custom integration? The initialization will differ, depending
if (process.env.TOKEN || process.env.SLACK_TOKEN) {
    //Treat this as a custom integration
    var customIntegration = require('./lib/custom_integrations');
    var token = (process.env.TOKEN) ? process.env.TOKEN : process.env.SLACK_TOKEN;
    var controller = customIntegration.configure(token, config, onInstallation);
} else if (process.env.CLIENT_ID && process.env.CLIENT_SECRET && process.env.PORT) {
    //Treat this as an app
    var app = require('./lib/apps');
    var controller = app.configure(process.env.PORT, process.env.CLIENT_ID, process.env.CLIENT_SECRET, config, onInstallation);
} else {
    logger.error('Error: If this is a custom integration, please specify TOKEN in the environment. If this is an app, please specify CLIENTID, CLIENTSECRET, and PORT in the environment');
    process.exit(1);
}


/**
 * A demonstration for how to handle websocket events. In this case, just log when we have and have not
 * been disconnected from the websocket. In the future, it would be super awesome to be able to specify
 * a reconnect policy, and do reconnections automatically. In the meantime, we aren't going to attempt reconnects,
 * WHICH IS A B0RKED WAY TO HANDLE BEING DISCONNECTED. So we need to fix this.
 *
 * TODO: fixed b0rked reconnect behavior
 */
// Handle events related to the websocket connection to Slack
controller.on('rtm_open', function (bot) {
    logger.debug('** The RTM api just connected!');
});

controller.on('rtm_close', function (bot) {
    logger.debug('** The RTM api just closed');
    // you may want to attempt to re-open
});


// BEGIN EDITING HERE!
controller.on('bot_channel_join', function (bot, message) {
    bot.reply(message, botname + " is here!")
});

function jiraConnect()
{
    var username = process.env.JIRABOT_USERNAME;
    var password = process.env.JIRABOT_PASSWORD;
    var JiraClient = require('jira-connector');
        var jira = new JiraClient( {
            host: 'jira.libredigital.com',
            basic_auth: {
                //TODO:use OAUTH and Bot Account
                "username": username,
                "password": password,
                }
        });
    return jira;
}
//Greeting (Useful for checking if the bot is able to respond)
//A bot can show as online but not actually listening to messages.
controller.hears(['hello', 'hi', 'greetings', 'status check', 'hey'], ['direct_mention', 'mention', 'direct_message'], function(bot,message) {
     bot.reply(message, 'Hello!');
 });
controller.hears(['help', 'explain', 'more info', 'commands', 'list of commands', 'command list'], ['direct_mention', 'mention', 'direct_message'], function(bot,message) {
     var helptext = "Create: I\'ll ask you questions and create a ticket from your answers\n"
                + "Issues: Just input the IssueKey (e.g. DOPS-1418) and I'll tell you more about the Issue!\n"
                + "Hi / Status Check: These keywords are just there to make sure I'm listening.\n"
     bot.reply(message, helptext);
 });

//Pattern: Issue Key (2 to 4 Letters, followed by a hyphen, then 3 to 8 numbers)
//[A-Z]{2,4}-[0-9]{3,5}
controller.hears(['([A-Z]{2,4}-[0-9]{0,5})(.*)',],
    ['direct_mention', 'mention', 'direct_message'], function(bot,message) {
    //message.match[0] would be the whole message
    //so we use message.match[1] for the issueKey
    var messageText = message.match[0];
    var issueKey = message.match[1];
    var jira = jiraConnect();
    jira.issue.getIssue({
        issueKey: issueKey
    }, function(error, issue) {
          var output = "";
          //if the issue key is null, then just output that the issue couldn't be found
          if(issue == null)
          {
            output += "Sorry, I couldn't find an issue with IssueKey " + issueKey;
            logger.error("NoIssueWithKey: " + message.match[0]);
          }
          else if( message.text.includes('JSON') ){
          //JSON mode just has system output the entire JSON
                output += "JSON:" + JSON.stringify(issue);
          }
          else{
            logger.info("Issue: " + message.match[0] );
            //Otherwise, start trying to evaluate the following items
            //List of items that we're trying to get from the JIRA Issue
            //List of items is at top of file for easier editing

            //If user specifies a field then only push that field
            var specificFields = message.match[2];
            if ((specificFields != null) && (specificFields != "")) {

              var arr = [];

              field = message.match[2].trim();
              field = field.toLowerCase();
              field = field.toLowerCase();
              items.forEach(function(item){
                var descriptor = item[0].toLowerCase();
                if (field == descriptor) {
                  arr.push(item);
                }
              });

              if(arr != null){
                items = arr;
              }//end if(arr != null)
            }//end if ((specificFields != null) && (specificFields != ""))

            //forEach item, try to eval it, add messageIfNull to ouptut if eval fails
            items.forEach(function(item){

                    var descriptor = item[0];
                    var messageIfNull = item[2];
                    var printIfnull = item[3];
                    try {
                      //Load the value and apply the character limit
                      var value = eval(item[1]);
                      if (value.length > character_limit ){
                        value = value.substring(0, character_limit);
                        value = value.substring(0, Math.min(value.length, value.lastIndexOf(" ")));
                        value += '...';
                      }

                      //The above line should throw an error if the value is null
                      //but using eval seems to ignore that.

                      //if item is null AND printIfnull is false, throw an error so that output is not appended
                      if(value === null){
                        //For some reason, throwing a TypeError here doesn't seem to actually
                        //  create an instanceof TypeError.
                        //throw TypeError;
                        //TODO: Throw error correctly instead of purposefully calling a broken object.
                        var create_error = value.length;
                      }
                      //make the Descriptor bold format
                      output +="*"
                      output += descriptor + ":* ";
                      //if the field is more than 80 characters, prepend it with a newline
                      if(value.length > 80){
                        output+= "\n";
                      }
                      output += value;
                    }
                    catch (e) {
                      //if this is a TypeError, then the issue is the value is null.
                      if (e instanceof TypeError || value == null) {
                        //if the value is null, but printIfnull is true, print it anyway
                        //and add the correct messageIfNull
                          if(printIfnull){
                            output +="*"
                            output += descriptor + ":* ";
                            output += item[2];
                          }
                          //else, don't print anything, but also don't log anything to console
                      }
                      //if the value isn't null but some other error has occurred, throw a big error
                      else{
                          logger.error("Error when evaluating data (please report this error to the SlackBot Admin).\n"
                          + "Error Message:" + e);
                          output += "value is not null but another error occurred (please report this error to the SlackBot Admin)";
                      }
                    }//end catch
                    //Add a newline character once done evaluating
                    output+="\n";
                  });//end forEach
          //Attachements are returned as an array so they have to also be given a forEach loop
          //Unfortunately, this requires another try/catch
          if ((specificFields == "Attachments") || (specificFields == "") || (specificFields == null)) {
            try {
              var attachments = issue.fields.attachment;
              if (attachments != null && attachements != ""){
                output += "*Attachments:*\n"
                attachments.forEach(function(attachment){
                    output += attachment.content + "\n";
                });
              }
            }
            catch (e){

            }
          }//end if ((specificFields == "Attachments") || (specificFields == "") || (specificFields == null))
        }//end else
        bot.reply(message,output);
        })//end jira.issue.getIssue
        //finally, push the output

});//end controller hears IssueKey pattern

//Keyword 'Create'
controller.hears(['Create'],['direct_mention', 'mention', 'direct_message'],
  function(bot,message,projectKey,summary,description,issueType,issueKey)
  {
    bot.startConversation(message,function(err,convo) {
      convo.on('end',function(convo) {
        if (convo.status=='completed') {
          var link = 'https://jira.libredigital.com/secure/CreateIssueDetails!init.jspa?';
          //Get this info from Slack:
          //TODO: Get Username from Slack
          var projectKey = 'DOPS';
          var issueType = 'Bug';
          var items = [
                        ['pid',pidTable[projectKey]],
                        ['summary', summary],
                        ['description', description],
                        ['issuetype',issueTypeTable[issueType.toLowerCase()]],
                        ['priority',6], //Priority 6 is 'Normal' Priority
                      ];
          //get the last item in the array for later use
          var last = items.pop();
          //loop to output each item as a key value pair, using = and &
          items.forEach(function(item){
            var arg = item[0];
            var value = item[1];
            link+= arg + '=';
            link+= value + '&';
          });
          link+= last[0] + '=' + last[1]; // no & on last item
          //Replace spaces with %20
          link = link.replace(/ /g,"%20");
          //TODO: Make this link look nicer or be embedded
          logger.info("Create: " + link);
          bot.reply(message,link);

        } else {
          //This shouldn't happen unless jirabot crashes
          logger.error("ErrorCreate" + pidTable[projectKey] + ","
           + summary + ","
           + description + ','
           + issueTypeTable[issueType.toLowerCase()]
           + "\n jirabot probably crashed");

        }

      });
      convo.addQuestion('You want to Create an Issue? What\'s the Project Key?[AP,BLU,CDT,DOPS,HRV]', function(response,convo) {
      projectKey = response.text;
      //TODO: Check to ensure project exists
      convo.next();
      },{},'default');
      convo.addQuestion('Summary?', function(response,convo) {
      summary = response.text;
      convo.next();
      },{},'default');
      convo.addQuestion('Description?', function(response,convo) {
      description = response.text;
      convo.next();
      },{},'default');
      convo.addQuestion('Issue Type?[Bug,Epic,Improvement,Story,Test]', function(response,convo) {
      issueType = response.text;
      convo.status ='completed';
      convo.next();
      },{},'default');
    })//end conversation
});//end create

//Keyword: Issue
//This just exists to remind users they can just type in issueKeys
controller.hears(['Issue','Key'],['direct_mention', 'mention', 'direct_message'],
  function(bot,message)
  {
    bot.reply(message, 'For info on a specific JIRA issue, just tell me its IssueKey\n'
            + '*Example:* @'+ botname + ' DOPS-1418');
});
controller.hears(['fields','field','specific'],['direct_mention', 'mention', 'direct_message'],
  function(bot,message)
  {
    bot.reply(message, 'If you want only a specific field, just state that field after the IssueKey\n'
            + '*Example:* @'+ botname + ' DOPS-1418 Description');
});
controller.hears(['.*'],['direct_mention', 'mention', 'direct_message'],
  function(bot,message)
  {
    logger.error("NoAction: " + message.match[0]);
    bot.reply(message, "Didn't understand that. Try \'Help\' ?");
});
