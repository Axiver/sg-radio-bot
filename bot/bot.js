//Load required modules
var discord = require("discord.js");
var client = new discord.Client();
var https = require("https");
var convert = require('xml-js');
var config = require("./config.json");
var moment = require("moment");

//Kiss92 stream URL
var radioStream = "http://playerservices.streamtheworld.com/api/livestream-redirect/KISS_92AAC.aac?tdtok=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiIsImtpZCI6ImZTeXA4In0.eyJpc3MiOiJ0aXNydiIsInN1YiI6IjIxMDY0IiwiaWF0IjoxNTgxNTE0MTQ4LCJ0ZC1yZWciOmZhbHNlfQ.k8L5xHd8S01FJ9a9QVxd8A48Eli9O_V9N89aiKkli48";
var infoStream = "https://np.tritondigital.com/public/nowplaying?mountName=KISS_92AAC&numberToFetch=1&eventType=track&request.preventCache=1581742131922";

//Boot discord bot
client.on("ready", () => {
	//Logged in to bot account
	console.log(`Logged in as ${client.user.tag}`);
});

//Pretty print song duration
function str_pad_left(string,pad,length) {
    return (new Array(length+1).join(pad)+string).slice(-length);
}

//Format strings so that only the first letter is Capitalised
function capitalizeFirstLetter(str) {
	let string = str.toLowerCase();
  	let result = string[0].toUpperCase() + string.slice(1);
  	return result;
}

//Starts the radio stream
function playStream(message) {
	//Find the voice channel
	if (!message.member.voiceChannel) {
		message.channel.send("You need to be in a voice channel!");
		return;
	}
	//Join the voice channel
	message.member.voiceChannel.join().then(connection => {
		message.channel.send("Connected to voice channel!");
		//Create broadcast
		let broadcast = client.createVoiceBroadcast();
		//Get stream from Kiss92
		broadcast.playArbitraryInput(radioStream);
		//Broadcast to every VC the bot is connected to
		for (const connection of client.voiceConnections.values()) {
		  	connection.playBroadcast(broadcast);
		}
	});
}

//Ends the radio stream
function endStream(message, client) {
	//Find the voice channel
	if (!message.guild.me.voiceChannel) {
		message.channel.send("Radio stream was never started");
		return;
	}
	//Leave the voice channel
	message.guild.me.voiceChannel.leave();
	message.channel.send("Radio stream stopped.");
}

//Get song info
function getSongInfo(message) {
	return new Promise((resolve, reject) => {
		console.log("hello");
		//Send http request to Kiss92
		https.get(infoStream, function(res) {
			res.on('data', (data) => {
				//Set options for parser
				let options = {
					compact: true,
					ignoreDoctype: true,
					attributesKey: "attributes"
				};
				//Parse into JSON
				let result = JSON.parse(convert.xml2json(data, options));
				//Read JSON
				let songTitle = result["nowplaying-info-list"]["nowplaying-info"]["property"][2]["_cdata"];
				let songArtist = result["nowplaying-info-list"]["nowplaying-info"]["property"][3]["_cdata"];
				let songStartTime = result["nowplaying-info-list"]["nowplaying-info"]["property"][1]["_cdata"];
				let songDuration = result["nowplaying-info-list"]["nowplaying-info"]["property"][0]["_cdata"];
				//Convert Song duration from Unix Timestamp to human readable format
				songDuration = songStartTime - songDuration;
				songDuration = moment.unix(songDuration/1000);
				//Convert Song start time from Unix Timestamp to human readable format
				let songStartMoment = moment.unix(songStartTime/1000);
				songStartTime = songStartMoment.format('h:mm:ssa');
				//Calculate Song duration
				let duration = moment.duration(songStartMoment.diff(songDuration)).as('seconds');
				let minutes = Math.floor(duration / 60);
				let seconds = duration - minutes * 60;
				songDuration = str_pad_left(minutes,'0',2)+':'+str_pad_left(seconds,'0',2);
				console.log(songDuration);
				//Send song info to chat
				message.channel.send({embed: {
					color: 3447003,
					author: {
						name: client.user.username,
						icon_url: client.user.avatarURL
					},
					title: "Kiss92",
					description: "Song Info",
					fields: [{
						name: "Song Title",
						value: capitalizeFirstLetter(songTitle),
						inline: true
					},
					{
						name: "Artist",
						value: capitalizeFirstLetter(songArtist),
						inline: true
					},
					{
						name: "Start time",
						value: songStartTime,
						inline: true
					},
					{
						name: "Song Duration",
						value: songDuration,
						inline: true
					}],
					footer: {
				      icon_url: client.user.avatarURL,
				      text: "Info taken from Kiss92's API"
				    }
				}});
				resolve();
			});
		});
	});
}

//Bot commands
client.on("message", async message => {
	//Check if the message is a command
	if (message.content.startsWith("!")) {
		//Convert to lower case
		message.content = message.content.toLowerCase();
		let command = message.content;
		if (command === "!play") {
			//Initiate Kiss92 stream
			playStream(message);
		} else if (command === "!stop") {
			//Disconnect from the voice channel
			endStream(message, client);
		} else if (command === "!song") {
			//Get song info
			await getSongInfo(message);
		}
	}
});

//Login to discord
client.login(config.token);