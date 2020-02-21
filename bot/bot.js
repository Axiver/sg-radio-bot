//Load required modules
var discord = require("discord.js");
var client = new discord.Client();
var https = require("https");
var convert = require('xml-js');
var config = require("./config.json");
var moment = require("moment");

//Kiss92 stream URL
var kiss92Stream = "http://playerservices.streamtheworld.com/api/livestream-redirect/KISS_92AAC.aac?tdtok=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiIsImtpZCI6ImZTeXA4In0.eyJpc3MiOiJ0aXNydiIsInN1YiI6IjIxMDY0IiwiaWF0IjoxNTgxNTE0MTQ4LCJ0ZC1yZWciOmZhbHNlfQ.k8L5xHd8S01FJ9a9QVxd8A48Eli9O_V9N89aiKkli48";
var kiss92InfoStream = "https://np.tritondigital.com/public/nowplaying?mountName=KISS_92AAC&numberToFetch=1&eventType=track&request.preventCache=1581742131922";
var kiss92SecondInfoStream = "https://feed.tunein.com/profiles/s180099/nowPlaying?token=eyJwIjpmYWxzZSwidCI6IjIwMjAtMDItMTdUMTA6MjE6NDMuNzI2MDE0N1oifQ&itemToken=BgUFAAEAAQABAAEAb28Bg78CAAEFAAA&formats=mp3,aac,ogg,flash,html,hls&serial=7ba551c5-cece-424f-aceb-1be5e3c5062c&partnerId=RadioTime&version=3.8&itemUrlScheme=secure&reqAttempt=1";

//YES 933 stream URL
var yes933Stream = "http://playerservices.streamtheworld.com/api/livestream-redirect/YES933_PREM.aac?tdtok=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiIsImtpZCI6ImZTeXA4In0.eyJpc3MiOiJ0aXNydiIsInN1YiI6IjIxMDY0IiwiaWF0IjoxNTgxOTQwNzg2LCJ0ZC1yZWciOmZhbHNlfQ.1hYK0m1_6eSKv_ZqT5uPmEboyuAEEQud0jOVemLBk_M";
var yes933InfoStream = "https://np.tritondigital.com/public/nowplaying?mountName=YES933_PREM&numberToFetch=1&eventType=track&request.preventCache=1581742131922";
var yes933SecondInfoStream = "https://feed.tunein.com/profiles/s25609/nowPlaying?token=eyJwIjpmYWxzZSwidCI6IjIwMjAtMDItMTdUMTA6MjE6NDMuNzI2MDE0N1oifQ&itemToken=BgUFAAEAAQABAAEAb28Bg78CAAEFAAA&formats=mp3,aac,ogg,flash,html,hls&serial=7ba551c5-cece-424f-aceb-1be5e3c5062c&partnerId=RadioTime&version=3.8&itemUrlScheme=secure&reqAttempt=1";

//Misc vars
var currentStation = dispatcher = "";

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
		if (result.subTitle === "Kiss92") {
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
			if (station == "") {
				message.channel.send("There is no radio station playing at the moment");
				reject();
			}
		}
		//Find infoStream
		if (station == "kiss92") {
			data.infoStream = kiss92InfoStream;
			data.secondInfoStream = kiss92SecondInfoStream;
		} else if (station == "yes933") {
			data.infoStream = yes933InfoStream;
			data.secondInfoStream = yes933SecondInfoStream;
		} else {
			message.channel.send("Something went wrong.");
			reject();
		}
		resolve(data);
	});
}

//Get song info
function getSongInfo(message) {
	return new Promise(async (resolve, reject) => {
		let outcome = await determineSongInfoStream(message);
		if (!outcome)
			return;
		let infoStream = outcome.infoStream;
		let secondInfoStream = outcome.secondInfoStream;
		//Send http request to radio station
		let data = await requestURL(infoStream);
		//Parse XML to JSON
		data = await XMLtoJSON(data);
		//Read JSON
		let result = await songDuration(data);
		//Get more info on the current song
		result = await backupSongInfo(result, secondInfoStream);
		//Send song info to chat
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
				if (station == "kiss92") {
					//Kiss92
					var stream = kiss92Stream;
				} else if (station == "yes933") {
					//YES 933
					var stream = yes933Stream;
				} else if (!station) {
					message.channel.send("Please select a radio station. [Kiss92, Yes933]");
					return;
				} else {
					//Station is not supported
					message.channel.send("Radio station does not exist!");
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
		} else if (command === "!stop") {
			//Disconnect from the voice channel
			endStream(message, client);
		} else if (command.startsWith("!song")) {
			//Get song info
			getSongInfo(message);
		}
	}
});

//Login to discord
client.login(config.token);