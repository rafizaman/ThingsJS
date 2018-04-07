var EventEmitter = require('events').EventEmitter;
var mqtt = require('mqtt');
var mosca = require('mosca');

var DEFAULT_PUBSUB_URL = 'mqtt://localhost';

function Pubsub(url, options){
	EventEmitter.call(this);
	var self = this;
	
	this.url = url || DEFAULT_PUBSUB_URL;
	this.handlers = {};
	this.subscriptions = {};

	// this.status = Pubsub.Status.Initialized;
	this.client = mqtt.connect(this.url);
	
	this.client.on('connect', function(ack){
		console.log('[Pubsub] connected');
		// self.status = Pubsub.Status.Connected;
		self.emit('ready');
		self.subscriptions = {};
		Object.keys(self.handlers).forEach(function(topic){
			self.client.subscribe(topic);
			self.subscriptions[topic] = true;
		});
		// if (self.status !== Pubsub.Status.Killed){
		// 	console.log('[Pubsub] connected');
		// 	self.status = Pubsub.Status.Connected;
		// 	self.emit('ready');
		// 	self.subscriptions = {};
		// 	Object.keys(self.handlers).forEach(function(topic){
		// 		self.client.subscribe(topic);
		// 		self.subscriptions[topic] = true;
		// 	});
		// }
		// else {
		// 	self.client.disconnecting = false;
		// 	self.client.end(true, function(){
		// 		console.log('[Pubsub] client end called');
		// 		clearTimeout(self.client.connackTimer);
		// 	});
		// 	console.log(self.client.disconnecting);

		// 	console.log('[Pubsub] previously killed');
		// }
	});
	this.client.on('reconnect', function(){
		console.log('[Pubsub] reconnecting');
	});
	this.client.on('close', function(){
		// self.status = Pubsub.Status.Closed;
	});
	this.client.on('end', function(){
		console.log('[Pubsub] client ended');
	});
	this.client.on('message', function(topic, message, packet){
		message = JSON.parse(message);
		self.handlers[topic](message, topic);
	});
}
// Pubsub.Status = {
// 	Initialized: 0,
// 	Connected: 1,
// 	Closed: 2,
// 	Killed: 3
// };
Pubsub.prototype = new EventEmitter();
Pubsub.prototype.subscribe = function(topic, handler){
	var self = this;
	return new Promise(function(resolve, reject){
		self.handlers[topic] = handler;
		if (topic in self.subscriptions) resolve(topic);
		else self.client.subscribe(topic, function(err, ack){
			if (err) reject(err);
			else resolve(topic);
		})

	})
}
Pubsub.prototype.unsubscribe = function(topic){
	var self = this;
	return new Promise(function(resolve, reject){
		delete self.handlers[topic];
		if (topic in self.subscriptions){
			delete self.subscriptions[topic];
			self.client.unsubscribe(topic, function(err){
				if (err) reject(err);
				else resolve(topic);
			})
		}
		else resolve(topic);
	})
}
Pubsub.prototype.publish = function(topic, message){
	var self = this;
	return new Promise(function(resolve, reject){
		self.client.publish(topic, JSON.stringify(message), function(err){
			if (err) reject(err);
			else resolve(true);
		})
	})
}
Pubsub.prototype.kill = function(){
	var self = this;
	return new Promise(function(resolve, reject){
		self.once('ready', function(){
			self.client.end(function(){
				console.log('[Pubsub] gracefully killed');
				resolve(true);
			});
		});
	});
}

function PubsubServer(){

}

Pubsub.Server = PubsubServer;

module.exports = Pubsub;