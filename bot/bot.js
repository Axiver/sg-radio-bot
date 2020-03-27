//Load required modules
var discord = require("discord.js");
var client = new discord.Client();
var https = require("https");
var convert = require('xml-js');
var config = require("./config.json");
var moment = require("moment");
var fs = require("fs");
var genius = require("genius-lyrics-api");

//Misc vars
var dispatcher = "";
var streams = [];
var radioCache = [];
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
function playStream(message, stationStream, station) {
	return new Promise((resolve, reject) => {
		//Find the voice channel
		if (!message.member.voiceChannel) {
			message.channel.send("You need to be in a voice channel!");
			return;
		}
		//Searches through radioCache array to see if an active radio stream for this station is active
		let index = radioCache.findIndex(data => data.station == station);
		if (index > -1) {
			//An active stream has been found
			var broadcast = radioCache[index]['broadcast'];
		} else {
			//There is no active stream. Create one.
			//Create and bind broadcast to radioCache array
			let json = {"station": station, "broadcast": client.createVoiceBroadcast()};
			//Push the newly created broadcast to the array
			index = radioCache.push(json);
			var broadcast = radioCache[index-1]['broadcast'];
			//Get stream from radio station and blast it into the broadcast
			const dispatcher = broadcast.playArbitraryInput(stationStream);
		}
		//Join the voice channel and play the radio stream
		message.member.voiceChannel.join().then(connection => {
			connection.playBroadcast(broadcast);
		});
		resolve();
	});
}

//Ends the radio stream
function endStream(message) {
	return new Promise((resolve, reject) => {
		//Find the voice channel
		if (!message.guild.me.voiceChannel) {
			//Check that this guild's stream info has been cleared
			message.channel.send("Radio stream was never started");
		} else {
			//Leave the voice channel
			message.guild.me.voiceChannel.leave();
			message.channel.send("Radio stream stopped.");
		}
		//Set the stream of the guild to nothing
		let guildID = message.guild.id;
		let station = "";
		//Loops through the streams array to search for this guildID
		for (i = 0; i < streams.length; i++) {
			//Checks if the guildID is present in the array
			if (streams[i].guild == guildID) {
				station = streams[i].name;
				//Remove the entry from the array
				streams.splice(i, 1);
			}
		}
		clearCache(station);
		resolve();
	});
}

//Clears the radioCache and streams array
function clearCache(station) {
	console.log("Client list: ");
	console.log(streams);
	console.log("RadioCache: ");
	console.log(radioCache);
	console.log("Total length of client list: " + streams.length);
	console.log(streams.length == 0);
	//Checks if anyone else is listening to the radio stream
	for (i = 0; i < streams.length; i++) {
		console.log(i);
		//Checks if the station is being listened to by others
		if (streams[i].name != station && i == streams.length-1) {
			//The guild is not listening to the station and they are the last in the array
			//Searches through radioCache array to find the index of the station
			let index = radioCache.findIndex(data => data.station == station);
			console.log("Index of " + station + " is " + index);
			//Remove the radio stream from the radioCache array
			radioCache.splice(index, 1);
		} else if (streams[i].name == station) {
			console.log("Someone is listening, breaking loop");
			//The guild is listening to the station
			i = streams.length + 1; //Breaks the loop
		}
	}
	
	//Checks if there are any listeners
	if (streams.length == 0) {
		console.log("No one is listening");
		//No one is listening anymore, clear everything.
		radioCache = [];
		streams = [];
	}
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
function firstSongInfo(data) {
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
		//Get song title and artist
		result.title = data["nowplaying-info-list"]["nowplaying-info"]["property"][2]["_cdata"];
		result.artist = data["nowplaying-info-list"]["nowplaying-info"]["property"][3]["_cdata"];
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
			//Get the name of the station currently playing
			let guildID = message.guild.id;
			let streamInfo = await getStream(guildID);
			station = streamInfo.name;
			if (station == "") {
				message.channel.send("There is no radio station playing at the moment");
				return;
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
			//Station does not exist, notify user
			message.channel.send("The station does not exist.");
			return;
		}
		//Checks if the station has URLs for obtaining song info
		if (data.infoStream == "-") {
			//Station does not have a valid info url
			message.channel.send("Could not find the info url for requested station");
			return;
		}
		resolve(data);
	});
}

//Get song info
function getSongInfo(message) {
	return new Promise(async (resolve, reject) => {
		let station = await determineSongInfoStream(message);
		//Send http request to radio station
		let data = await requestURL(station.infoStream);
		//Parse XML to JSON
		data = await XMLtoJSON(data);
		//Read JSON
		let result = await firstSongInfo(data);
		//Get more info on the current song
		result = await backupSongInfo(result, station.secondInfoStream);
		resolve(result);
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
			let radioTemp = new station(radioStation.name, radioStation.stream, radioStation.mainInfo, radioStation.secondaryInfo);
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

//Adds new radio stations to the station list
async function addStation(message) {
	//Removes !addstation
	let command = message.content.split(" ").splice(1, 4);
	//Perform check
	for (i = 0; i < 4; i++) {
		let element = command[i];
		//Checks if the URL or stream name is not present
		if (element == undefined) {
			if (i < 2) {
				//Inform user
				message.channel.send("The stream name and URL are required");
				//Abort
				return;
			} else if (i > 1) {
				//Sets the streaminfo urls as "-"
				command[i] = "-";
			}
		}
	};
	//Create a new station object
	let radioStation = new station(command[0], command[1], command[2], command[3]);
	//Update stationlist with new station
	stationlist[stationlist.length] = radioStation;
	//Update stations.json with new stationlist
	let json = {};
	json["stations"] = stationlist;
	fs.writeFile('stations.json', JSON.stringify(json), 'utf8', () => {
		//Notify user
		message.channel.send(`Station ${radioStation.name} has been added!`);
	});
}

//Parses the lyrics from Genius API
function parseLyrics(lyrics) {
	return new Promise((resolve, reject) => {
		//Format the result into a discord-sendable format
		let formatted = [];
		//Check if genius has returned any lyrics
		if (lyrics != null) {
			//Split the lyrics into sections
			let result = lyrics.split(/[\[\]]+/);
			//Check if the lyrics have section titles (Genius is inconsistent af)
			if (result.length <= 1) {
				//Lyrics do not have section titles
				//Auto-split lyrics into sections
				lyrics = result[0].split('\n\n');
				//Loop through the array section by section (2 elements at a time)
				for (i = 1; i < lyrics.length; i++) {
					//Format section title so that '[' and ']' are added back into it
					let sectionTitle = `Section ${i}`;
					let lyricSection = {"name": sectionTitle, "value": lyrics[i]};
					formatted.push(lyricSection);
				}
			} else {
				//Loop through the array section by section (2 elements at a time)
				for (i = 1; i < result.length; i++) {
					//Format section title so that '[' and ']' are added back into it
					let sectionTitle = '['+result[i]+']';
					//Increase the value of i again to access the lyrics for that section
					i++;
					let lyricSection = {"name": sectionTitle, "value": result[i]};
					formatted.push(lyricSection);
				}
			}
		} else {
			formatted[0] = {"name": "-", "value": "-"};
		}
		resolve(formatted);
	});
}

//Message loading animation
async function loadAnimation(progress, result, message) {
	let guildID = message.guild.id;
	let streamInfo = await getStream(guildID);
	return new Promise((resolve, reject) => {
  		//The lyrics have not yet been added
		//Get the appropriate symbol
		let symbols = ["/", "—", "\\", "|", "/", "—", "\\", "|"];
		progress = symbols[progress];
		//Edit the previously sent temporary message
		message.edit({embed: {
			color: 3447003,
			author: {
				name: capitalizeFirstLetter(streamInfo.name),
				icon_url: client.user.avatarURL
			},
			title: result.title,
			description: result.artist,
			thumbnail: {
				url: result.albumArt,
			},
			fields: [{
				"name": "Retrieving Lyrics",
				"value": `Please give me a moment ${progress}`
			}],
			footer: {
		      icon_url: client.user.avatarURL,
		      text: "Lyrics will be obtained by sending a dummy request to Genius"
		    }
		}});
		resolve();
	});
}

//Gets the stream info of the current guild
function getStream(guildID) {
	return new Promise((resolve, reject) => {
		//Loops through the streams array to search for this guildID
		let streamInfo = {};
		for (i = 0; i < streams.length; i++) {
			//Checks if the guildID is present in the array
			if (streams[i].guild == guildID) {
				//Current guild has a ongoing stream. Retrieve information on the stream.
				streamInfo.name = streams[i].name;
			}
		}
		resolve(streamInfo);
	});
}

//Updates stream information for the current guild
function updateStream(guildID, station) {
	return new Promise(async (resolve, reject) => {
		//Loops through the streams array to search for this guildID
		let json = {"guild": guildID, "name": station};
		if (streams.find(item => item.guild == guildID)) {
			//The guildid is in the array
			//Find the index of the guildid
			let index = streams.findIndex(stream => stream.guild == guildID);
			let oldStation = streams[index].name;
			//Current guild had a previous stream. Update the name of the station being streamed to the current one.
			streams[index].name = station;
			clearCache(oldStation);
		} else {
			//It is not in the array
			//The guildID was not present in the streams array
			//Push the new entry into the array
			let json = {"guild": guildID, "name": station};
			streams.push(json);
		}
		resolve();
	});
}

//Boot sequence for the bot
async function boot() {
	//Load radio stations to memory
	console.log("Loading radio station list to memory...");
	await loadRadio();
	console.log("Radio stations read to memory!");
	//Login to discord
	console.log("Logging in to discord...");
	await client.login(config.token);
	console.log(`Logged in as ${client.user.tag}`);
}

//-- Main bot --//

//Boot discord bot
client.on("ready", async () => {
	//-- Boot Sequence --//
	//Logged in to bot account
	client.user.setActivity("Type !help to see my commands", {
		type: "STREAMING",
		url: "https://github.com/Garlicvideos/sg-radio-bot"
	});
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
			//Get the guild id of the current discord server
			let guildID = message.guild.id;
			//Get the stream info of the current guild
			let streamInfo = await getStream(guildID);
			//Checks if the current station is the same as the one the user selected
			if (streamInfo.name !== station) {
				//Index stationlist array to see if the radio station exists
				let stream = await findStream(station);
				if (!stream) {
					message.channel.send("That radio station is not supported by this bot.");
					return;
				}
				//Checks if the guild has a ongoing radio stream
				if (streamInfo.name != null) {
					//Server has a ongoing stream
					//Switches from one station to another
					await playStream(message, stream, station);
					message.channel.send("Switched over from " + capitalizeFirstLetter(streamInfo.name) + " to " + capitalizeFirstLetter(station));
					//Set current station
					await updateStream(guildID, station);
					return;
				} else {
					//Server does not have an ongoing stream
					//Play selected radio stream
					await playStream(message, stream, station);
					//Set current station
					await updateStream(guildID, station);
					return;
				}
			} else {
				//Rejoin if it got disconnected
				if (!message.guild.me.voiceChannel) {
					//Get radio stream URL
					let stream = await findStream(station);
					//Play selected radio stream
					await playStream(message, stream, station);
					//Set current station
					await updateStream(guildID, station);
				} else {
					message.channel.send(capitalizeFirstLetter(station) + " is already playing!");
				}
			}
		}

		//Stops radio stream
		if (command === "!stop") {
			//Disconnect from the voice channel
			await endStream(message);
		}

		//Fetches the info of the current song or of the current one being played on the specified radio station
		if (command.startsWith("!song")) {
			//Get song info
			let result = await getSongInfo(message);
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
		if (command.startsWith("!addstation")) {
			//Begin radio station addition process
			//addStation(message);
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
					name: "!lyrics <station> (Parameters are optional)",
					value: "Searches Genius for the lyrics of the current song being played",
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
				},
				{
					name: "!invite",
					value: "Sends the invite link for this bot to chat",
				},
				{
					name: "!reportbug",
					value: "Sends the URL for bug report submission",
				}],
				footer: {
			      icon_url: client.user.avatarURL,
			      text: "Command me daddy"
			    }
			}});
		}

		//Search for the lyrics for the current song
		if (command.startsWith("!lyrics")) {
			//Gets song info
			let result = await getSongInfo(message);
			let guildID = message.guild.id;
			let streamInfo = await getStream(guildID);
			//Bug fixing
			//result.title = "LET ME LOVE YOU";
			//result.artist = "DJ SNAKE FT. JUSTIN BIEBER";
			//Sends a temporary message
			message.channel.send({embed: {
				color: 3447003,
				author: {
					name: capitalizeFirstLetter(streamInfo.name),
					icon_url: client.user.avatarURL
				},
				title: result.title,
				description: result.artist,
				thumbnail: {
					url: result.albumArt,
				},
				fields: [{
					"name": "Retrieving Lyrics",
					"value": "Please give me a moment"
				}],
				footer: {
			      icon_url: client.user.avatarURL,
			      text: "Lyrics will be obtained by sending a dummy request to Genius"
			    }
			}}).then(tempMessage => {
				//Enable lyric loading animation (1 fps, or we get rate-limited by discord)
				let i = 0;
				loadAnimation(i, result, tempMessage);
				i++;
				let animation = setInterval(async function() {
					if (i < 8) {
						loadAnimation(i, result, tempMessage);
						i++;
					} else {
						i = 0;
						loadAnimation(i, result, tempMessage);
					}
				}, 1000);
				//Configure the API request
				let options = {
					apiKey: config['genius-token'],
					title: encodeURI(result.title),
					artist: encodeURI(result.artist),
					optimizeQuery: true
				};
				//Send the request to Genius
				genius.getLyrics(options).then(async lyrics => {
					//Split lyrics into sections (Verse 1, Verse 2, Chorus, etc)
					lyrics = await parseLyrics(lyrics);
					//Construct and send song lyrics to chat
					if (result.title == "-" || result.artist == "-") {
						result.title = "Lyrics";
						result.artist = "No lyrics were found";
					}
					//Stops the message loading animation
					await clearInterval(animation);
					tempMessage.edit({embed: {
						color: 3447003,
						author: {
							name: capitalizeFirstLetter(streamInfo.name),
							icon_url: client.user.avatarURL
						},
						title: result.title,
						description: result.artist,
						thumbnail: {
							url: result.albumArt,
						},
						fields: lyrics,
						footer: {
					      icon_url: client.user.avatarURL,
					      text: "Lyrics may not be accurate. The lyric feature is still unstable."
					    }
					}});
				});
			});
		}

		if (command == "!invite") {
			message.channel.send({embed: {
				color: 2399661,
				author: {
					name: client.user.username,
					icon_url: client.user.avatarURL
				},
				title: "Click here to invite me into your server!",
				url: "https://discordapp.com/oauth2/authorize?client_id=677155607127523348&scope=bot&permissions=8",
				description: "Please understand that this bot is still riddled with bugs",
				fields: [{
					name: "If the hyperlink above did not work, copy and paste the link below into your browser of choice",
					value: "https://discordapp.com/oauth2/authorize?client_id=677155607127523348&scope=bot&permissions=8"
				}],
				footer: {
			      icon_url: client.user.avatarURL,
			      text: "I'm a good boy"
			    }
			}});
		}

		if (command == "!reportbug") {
			message.channel.send({embed: {
				color: 2399661,
				author: {
					name: client.user.username,
					icon_url: client.user.avatarURL
				},
				title: "Click here to report a bug!",
				url: "https://github.com/Garlicvideos/sg-radio-bot/issues/new",
				description: "You will be required to have a Github Account",
				fields: [{
					name: "If the hyperlink above did not work, copy and paste the link below into your browser of choice",
					value: "https://github.com/Garlicvideos/sg-radio-bot/issues/new"
				}],
				footer: {
			      icon_url: client.user.avatarURL,
			      text: "What did I do wrong this time?"
			    }
			}});
		}

		if (command == "!bugfix") {
			console.log("Here is the radioCache:");
			console.log(radioCache);
			console.log("--------------------------------------------------------------------------");
			console.log("Here is the stream clients list:");
			console.log(streams);
			console.log("--------------------------------------------------------------------------");
		}
	}  
});

boot();