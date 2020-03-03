//Load required modules
var discord = require("discord.js");
var client = new discord.Client();
var https = require("https");
var convert = require('xml-js');
var config = require("./config.json");
var moment = require("moment");

//Misc vars
var currentStation = dispatcher = "";
var stationlist = [];

//-- Classes --//

//Radio station
function station(name, stream, info1, info2) {
	this.name = name;
	this.stream = stream;
	this.mainInfo = info1;
	this.secondaryInfo = info2;
}

//-- Functions --//

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
function playStream(message, stationStream) {
	return new Promise((resolve, reject) => {
		//Find the voice channel
		if (!message.member.voiceChannel) {
			message.channel.send("You need to be in a voice channel!");
			return;
		}
		//Join the voice channel
		message.member.voiceChannel.join().then(connection => {
			message.channel.send("Connected to voice channel!");
			//Create broadcast
			broadcast = client.createVoiceBroadcast();
			//Get stream from radio station
			dispatcher = broadcast.playArbitraryInput(stationStream);
			//Broadcast to every VC the bot is connected to
			for (const connection of client.voiceConnections.values()) {
			  	connection.playBroadcast(dispatcher);
			}
			resolve();
		});
	});
}

//Switches from a radio station to another
function switchStream(message, stationStream) {
	return new Promise((resolve, reject) => {
		//Leave the voice channel
		message.guild.me.voiceChannel.leave();
		message.member.voiceChannel.join().then(connection => {
			//Create broadcast
			broadcast = client.createVoiceBroadcast();
			//Get stream from radio station
			dispatcher = broadcast.playArbitraryInput(stationStream);
			//Broadcast to every VC the bot is connected to
			for (const connection of client.voiceConnections.values()) {
			  	connection.playBroadcast(dispatcher);
			}
			resolve();
		});
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
	currentStation = null;
	message.channel.send("Radio stream stopped.");
}

//Sends a https request to a endpoint
function requestURL(url) {
	return new Promise((resolve, reject) => {
		https.get(url, function(res) {
			var body = '';
			res.on('data', (data) => {
				body += data;
			});
			res.on('end', function() {
				resolve(body);
			});
		});
	});
}

//Parses data from XML to JSON
function XMLtoJSON(xml) {
	return new Promise((resolve, reject) => {
		//Set options for parser
		let options = {
			compact: true,
			ignoreDoctype: true,
			attributesKey: "attributes"
		};
		//Parse into JSON
		let result = JSON.parse(convert.xml2json(xml, options));
		resolve(result);
	});
}

//Calculates the duration of song, when it started and when it will end
function songDuration(data) {
	return new Promise((resolve, reject) => {
		let result = {};
		//Read JSON
		let songStartTime = data["nowplaying-info-list"]["nowplaying-info"]["property"][1]["_cdata"];
		let songDuration = data["nowplaying-info-list"]["nowplaying-info"]["property"][0]["_cdata"];
		//Convert Song duration from Unix Timestamp to human readable format
		songDuration = songStartTime - songDuration;
		songDuration = moment.unix(songDuration/1000);
		//Convert Song start time from Unix Timestamp to human readable format
		let songStartMoment = moment.unix(songStartTime/1000);
		result.songStartTime = songStartMoment.format('h:mm:ssa');
		//Calculate Song duration
		let duration = moment.duration(songStartMoment.diff(songDuration)).as('seconds');
		let minutes = Math.floor(duration / 60);
		let seconds = duration - minutes * 60;
		result.songDuration = str_pad_left(minutes,'0',2)+':'+str_pad_left(seconds,'0',2);
		//Calculate Song end time
		result.songEndTime = songStartMoment.add(seconds, 'seconds').add(minutes, 'minutes').format('h:mm:sa');
		resolve(result);
	});	
}

//Seperates Artist and Title into different strings
function splitSongInfo(songInfo) {
	return new Promise((resolve, reject) => {
		//Splits string into two
		let result = songInfo.split(" - ");
		let response = {};
		response.title = result[1];
		response.artist = result[0];
		resolve(response);
	});
}

//Finds the album art for the song
function backupSongInfo(result, secondInfoStream) {
	return new Promise(async (resolve, reject) => {
		//Make request to TuneIn endpoint
		let data = await requestURL(secondInfoStream);
		data = JSON.parse(data);
		//Get album art URL
		result.albumArt = data.Secondary.Image;
		//Gets slogan of selected station
		result.slogan = data.Primary.Subtitle;
		//Gets the current subtitle of the station
		result.subTitle = data.Secondary.Subtitle;
		//Gets the title and artist of current song
		let songInfo = data.Secondary.Title;
		//Split song info's combined title and artist into seperate strings
		songInfo = await splitSongInfo(songInfo);
		result.title = songInfo.title;
		result.artist = songInfo.artist;
		if (result.subTitle === "Kiss92" || result.subTitle === "ONE FM 91.3") {
			result.subTitle = "Song Info";
		} else if (result.subTitle === "Yes 93.3 FM") {
			result.subTitle = "歌曲信息";
		} else {
			result.title = "-";
			result.artist = "-";
		}
		resolve(result);
	});
}

//Determine the song info stream
function determineSongInfoStream(message) {
	return new Promise(async (resolve, reject) => {
		let data = {};
		//The station user has selected
		let station = message.content.split(" ")[1];
		if (station == undefined) {
			//The station currently playing
			station = currentStation;
			if (station == undefined) {
				message.channel.send("There is no radio station playing at the moment");
				reject();
			}
		}
		//Find infoStream
		stationlist.forEach(radioStation => {
			if (radioStation.name == station) {
				data.infoStream = radioStation.mainInfo;
				data.secondInfoStream = radioStation.secondaryInfo;
			}
		});
		//Checks if the json is still empty
		if (!Object.keys(data).length) {
			//Station does not exist, terminate
			reject(1);
		}
		//Checks if the station has URLs for obtaining song info
		if (data.infoStream == "-") {
			//Station does not have infostream, abort
			reject(2);
		}
		resolve(data);
	});
}

//Get song info
function getSongInfo(message) {
	return new Promise(async (resolve, reject) => {
		let station = await determineSongInfoStream(message).catch((err) => {
			//Respond appropriately to the error
			switch (err) {
				case 1:
					//Station does not exist, notify user
					message.channel.send("The station does not exist.");
					break;
				case 2:
					//Station does not have a valid info url
					message.channel.send("Could not find the info url for requested station");
					break;
				default:
					//Unknown error occured
					message.channel.send("Unknown error has occured. Please try again later.");
					break;
			}
			//Abort
			return;
		});
		//Send http request to radio station
		let data = await requestURL(station.infoStream);
		//Parse XML to JSON
		data = await XMLtoJSON(data);
		//Read JSON
		let result = await songDuration(data);
		//Get more info on the current song
		result = await backupSongInfo(result, station.secondInfoStream);
		//Construct and send song info to chat
		message.channel.send({embed: {
			color: 3447003,
			author: {
				name: client.user.username,
				icon_url: client.user.avatarURL
			},
			title: result.slogan,
			description: result.subTitle,
			thumbnail: {
				url: result.albumArt,
			},
			fields: [{
				name: "Song Title",
				value: result.title,
				inline: true
			},
			{
				name: "Artist",
				value: result.artist,
				inline: true
			},
			{
				name: "\u200b",
				value: "\u200b",
				inline: true
			},
			{
				name: "Start time",
				value: result.songStartTime,
				inline: true
			},
			{
				name: "End time",
				value: result.songEndTime,
				inline: true
			},
			{
				name: "Song Duration",
				value: result.songDuration,
				inline: true
			}],
			footer: {
		      icon_url: client.user.avatarURL,
		      text: "Info taken by intercepting TuneIn's Web Requests"
		    }
		}});
		resolve();
	});
}

//Loads station configurations
function loadRadio() {
	return new Promise((resolve, reject) => {
		//Read station config list
		var radioList = require("./stations.json").stations;
		//Loop through station list
		var i = 0;
		radioList.forEach(radioStation => {
			//Update stations array with each station read from radioList by initialising a new class
			let radioTemp = new station(radioStation.name, radioStation.streamURL, radioStation.infoURL, radioStation.secondaryInfo);
			stationlist[i] = radioTemp;
			i++;
		});
		resolve(true);
	});
}

//Indexes station list to search for streamURL
function findStream(station) {
	return new Promise((resolve, reject) => {
		let stream = "";
		stationlist.forEach(radioStation => {
			if (radioStation.name == station) {
				stream = radioStation.stream;
			}
		});
		resolve(stream);
	});
}

//-- Main bot --//

//Boot discord bot
client.on("ready", async () => {
	//-- Boot Sequence --//
	//Load radio stations to memory
	console.log("Loading radio station list to memory...");
	await loadRadio();
	console.log("Radio stations read to memory!");
	//Logged in to bot account
	console.log("Logging in to Discord...");
	console.log(`Logged in as ${client.user.tag}`);
	client.user.setActivity("Type !help to see my commands", {
		type: "STREAMING",
		url: "https://github.com/Garlicvideos/sg-radio-bot"
	});
	console.log("Bot is ready!");
});

//Bot commands
client.on("message", async message => {
	//Check if the message is a command
	if (message.content.startsWith("!")) {
		//Convert to lower case
		message.content = message.content.toLowerCase();
		let command = message.content;
		//Plays radio stream
		if (command.startsWith("!play")) {
			//The station user has selected
			let station = command.split(" ")[1];
			//Checks if the current station is the same as the one the user selected
			if (currentStation !== station) {
				//Index stationlist array to see if the radio station exists
				let stream = await findStream(station);
				if (!stream) {
					message.channel.send("That radio station is not supported by this bot.");
					return;
				}
				//End current stream if the bot is playing songs
				if (currentStation) {
					await switchStream(message, stream);
					message.channel.send("Switched over from " + capitalizeFirstLetter(currentStation) + " to " + capitalizeFirstLetter(station));
					//Set current station
					currentStation = station;
					return;
				} else {
					//Play selected radio stream
					await playStream(message, stream);
					//Set current station
					currentStation = station;
				}
			} else {
				message.channel.send(capitalizeFirstLetter(station) + " is already playing!");
			}
		}

		//Stops radio stream
		if (command === "!stop") {
			//Disconnect from the voice channel
			endStream(message, client);
		}

		//Fetches the info of the current song or of the current one being played on the specified radio station
		if (command.startsWith("!song")) {
			//Get song info
			getSongInfo(message);
		}

		//Reloads the radio station list so that new stations are registered without having to reboot the bot
		if (command.startsWith("!reload")) {
			//Reloads station list
			loadRadio().then((result) => {
				if (result) {
					message.channel.send("Radio station list has been reloaded.");
				} else {
					message.channel.send("Failed to reload radio station list.");
				}
			});
		}

		//Adds new radio station to bot
		if (command.startsWith("!addStation")) {
			//Checks if the command is up to standard
		}

		//Lists the available radio stations for selection
		if (command.startsWith("!stations")) {
			//Loops through radio station list
			let compiledMessage = "";
			let i = 0;
			stationlist.forEach(radioStation => {
				//Update stations array with each station read from radioList by initialising a new class
				if (i == 0) {
					compiledMessage += `${radioStation.name}`;
				} else {
					compiledMessage += `, ${radioStation.name}`;
				}
				i++;
			});
			message.channel.send(compiledMessage);
		}

		//Provide command list for the user
		if (command.startsWith("!help")) {
			//Construct and send command list
			message.channel.send({embed: {
			color: 0xd46d13,
			author: {
				name: client.user.username,
				icon_url: client.user.avatarURL
			},
			title: "Singapore Radio Bot",
			description: "These are the commands I respond to",
			fields: [{
				name: "!help",
				value: "Lists the available commands for this bot.",
			},
			{
				name: "!play <station>",
				value: "Plays the selected radio station if the bot supports it.",
			},
			{
				name: "!song <station> (Parameters are optional)",
				value: "Gets the information for the song the selected radio station is currently playing.",
			},
			{
				name: "!stop",
				value: "Stops the radio stream",
			},
			{
				name: "!reload",
				value: "Reloads the radio station list from config. Used to add new radio stations.",
			},
			{
				name: "!stations",
				value: "Lists the available radio stations for selection",
			}],
			footer: {
		      icon_url: client.user.avatarURL,
		      text: "Command me daddy"
		    }
		}});
		}
	}
});

//Login to discord
client.login(config.token);