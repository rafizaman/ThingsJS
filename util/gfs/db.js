var mongo = require('mongodb');
var mongoose = require('mongoose');
var FSObject = require('./FSObject.js');
var Schema = mongoose.Schema;


/* @param host : points to a mongodb url, e.g. mongodb://localhost:27017/<db_name>
 */
function ThingsDatabase(host){
	this.host = host;
	this.db = undefined;
	this.cache = {};
	this.stale = false;

	this._initialize();
}

/* Initialize the database
 */
ThingsDatabase.prototype._initialize = function(){
	var self = this;
	mongoose.connect(self.host);

	mongoose.connection.on('connected', function(){
		console.log('Connected to mongodb at: ' + self.host);
		self.db = mongoose.connection;
	})

	mongoose.connection.on('error', function(err){
		console.log('Mongoose connection error: ' + err);
	})
}

ThingsDatabase.prototype._tokenizePath = function(path){
	// parse the path into tokens
	var tokens = path.split('/');
	// ignore excess deliminators that leave empty elements
	for(var i = 0; i < tokens.length; i++){
		if(tokens[i] == ''){
			tokens.splice(i, 1);
		}
	}
	return tokens;	
}

/* Core function to view the filesystem from the client
 * @param path: absolute path of the file object
 */
ThingsDatabase.prototype.viewFileObject = function(path){
	console.log('<T> db.js -- viewFileObject: ' + path);
	var self = this;
	tokens = self._tokenizePath(path);

	var cachedPath = tokens.join('/');
	if(cachedPath in this.cache && !this.cache[cachedPath].stale){
		return new Promise(function(resolve, reject){
			resolve(self.cache[cachedPath]);
		});
	}

	return this._viewFileHelper(0, tokens, null);
}

ThingsDatabase.prototype._addToCache = function(path, ref){
	this.cache[path] = ref;
	this.cache[path].stale = false;
}

ThingsDatabase.prototype._staleCache = function(path){
	var tokens = this._tokenizePath(path);
	var cachedPath = tokens.join('/');

	console.log('<D> db.js -- _staleCache: ' + path);

	if(cachedPath in this.cache){
		this.cache[cachedPath].stale = true;
	}
}

/* Recursive function to view a file object
 * @param depth    : current depth of the file tree we are searching in
 * @param tokens   : tokens of the absolute path
 * @param parentId : parent of the token we are currently searching for
 */
ThingsDatabase.prototype._viewFileHelper = function(depth, tokens, parentId){
	var self = this;
	var fs = new FSObject();

	return new Promise(function(resolve, reject){
		var that = self;
		var recurseFind = function(depth, tokens, parentId, resolve){
			console.log('<T> db.js -- _viewFileHelper: ' + tokens[depth]);
			fs.getFileObject(tokens[depth], parentId)
				.then(function(data){
					if(!data){
						resolve(null);
						return;
					}
					if(depth == tokens.length - 1){
						if(data.type == 'file'){
							that._addToCache.call(that, tokens.join('/'), data);
							resolve(data);
						} 
						else{
							fs.getChildren(data._id)
								.then(function(children){
									data.content = children;
									that._addToCache.call(that, tokens.join('/'), data)
									resolve(data);
								});
							}
					} 
					else{
						recurseFind(++depth, tokens, data._id, resolve);
					}
				});
		}

		recurseFind(depth, tokens, parentId, resolve);
	},
	function(error){
		reject(error);
	});
}

/* @param id       : _id field of the file object to clone
 * @param parentId : the _id field of the parent directory to clone the object into
 * @param name     : the name of the cloned file object
 */
ThingsDatabase.prototype.cloneFile = function(id, name, parentId){
	return this._cloneFileHelper(id, name, parentId);
}

/* @param name     : must be unique to the destination path
 * @param filepath : the path of the file to clone
 * @param destPath : the destination path of the file to clone into
 *					 If null, the destination will be the original file object's directory
 */
ThingsDatabase.prototype.cloneFileFromPath = function(filePath, destPath, name){
	var self = this;
	return new Promise(function(resolve, reject){
		self.viewFileObject(filePath).then(function(data){
			if(!data){
				resolve(false);
				return;
			}
			if(destPath){
				self.viewFileObject(destPath).then(function(parent){
					if(!parent){
						resolve(false);
						return;
					}
					resolve(self.cloneFile(data._id, name, parent._id));
				})
			}
			else resolve(self.cloneFile(data._id, name, null));
		});
	});
}

/* recursive function to deep clone a file object and its descendants
 */
ThingsDatabase.prototype._cloneFileHelper = function(id, name, parentId){
	console.log('<T> db.js -- _cloneFileHelper: ' + id);
	var self = this;
	var fs = new FSObject();

	return new Promise(function(resolve, reject){
		var that = self;
		var deepClone = function(isRoot, id, parent, resolve){
			fs.getFileObjectById(id)
				.then(function(data){
					var newId = new mongoose.Types.ObjectId();
					if(isRoot){
						that.createFile(name, parent || data.parent, data.type == 'file', data.content, newId);
					}
					else{
						that.createFile(data.name, parent, data.type == 'file', data.content, newId);
					}
					if(data.type == 'directory'){
						fs.getChildren(id).then(function(children){
							if(children.length == 0){
								resolve(true);
								return;
							}
							for(var i = 0; i < children.length; i++){
								console.log('<D> db.js -- deepClone: child name ' + children[i].name);
								deepClone(false, children[i]._id, newId, resolve);
							}
						});
					}
					else{
						resolve(true);
						return;
					}
				});
		}

		deepClone(true, id, parentId, resolve);
	});
}

/* @param name       : name of the file or directory
 * @param parentId   : id of the parent 
 * @param isFile     : flag to check if the object is a file or directory 
 * @param content    : content of a file, null if object is a directory
 * @param id         : id of the object
 */
ThingsDatabase.prototype.createFile = function(name, parentId, isFile, content, id){
	var self = this;
	var fsobj = new FSObject({
		_id  : (id) ? id : new mongoose.Types.ObjectId(),
		name : name,
		type : (isFile) ? 'file' : 'directory',
		parent: parentId
	});
	if(isFile){
		fsobj.content = content;
	}
	fsobj.save(function(err){
		if(err){
			console.log('<E> db.js -- createFile: ' + err);
			return true;
		}
		return false;
		console.log('<D> db.js -- createFile: ' + name + ' created');
	});
}

/* Create a file object with paths
 * @param name        : name of the file or directory
 * @param parentPath  : absolute path of this file's parent directory
 * @param isFile      : flag to check if the object is a file or directory
 * @param fileContent : contents of the file, null if object is a directory 
 *
 */
ThingsDatabase.prototype.createFileFromPath = function(name, parentPath, isFile, fileContent){
	var self = this;
	return new Promise(function(resolve, reject){
		self.viewFileObject(parentPath).then(function(data){
			if(!data){
				resolve(false);
				return;
			}
			self._staleCache(parentPath);
			resolve(self.createFile(name, data._id, isFile, fileContent));
		});
	});
}

/* @param id : _id field of the file object to delete
 */
ThingsDatabase.prototype.deleteFile = function(id){
	console.log('<T> db.js -- deleteFile: ' + id);
	var fs = new FSObject();
	return fs.deleteFileObject(id);
}

/* @param path: implicit path of the file object
 */
ThingsDatabase.prototype.deleteFileFromPath = function(path){
	var self = this;

	return new Promise(function(resolve, reject){
		self.viewFileObject(path).then(function(data){
			if(!data){
				resolve(false);
			}
			var parent = path.split('/');
			parent.pop();
			self._staleCache(parent.join('/'));
			delete self.cache[path];

			resolve(self.deleteFile(data._id));
		});
	});
}

/* @param id         : _id field of the file to update
 * @param newContent : the content that will replace the previous file content
 */
ThingsDatabase.prototype.updateFile = function(id, newContent){
	console.log('<T> db.js -- updateFile: ' + id);
	var fs = new FSObject();

	return fs.overwriteFile(id, newContent);
}

ThingsDatabase.prototype.updateFileFromPath = function(path, newContent){
	var self = this;

	return new Promise(function(resolve, reject){
		self.viewFileObject(path).then(function(data){
			if(!data){
				resolve(false);
			}
			self._staleCache(path);
			resolve(self.updateFile(data._id, newContent));
		});
	});
}

/* Moves a file given its id and the id of its new parent
 * @param id          : _id field of the file object
 * @param newParentId : _id field of the new parent directory 
 */
ThingsDatabase.prototype.moveFile = function(id, newParentId){
	console.log('<T> db.js -- moveFile: ' + id + ', ' + newParentId);
	var fs = new FSObject();

	return fs.updateParent(id, newParentId);
}

/* Change the name of a file object
 * @param id      : _id field of the object
 * @param newName : the new name of the file object
 */
ThingsDatabase.prototype.changeName = function(id, newName){
	console.log('<T> db.js -- changeName: ' + id);
	var fs = new FSObject();

	return fs.updateName(id, newName);
}

ThingsDatabase.prototype.changeNameFromPath = function(path, newName){
	var self = this;
	return new Promise(function(resolve, reject){
		self.viewFileObject(path).then(function(data){
			if(!data){
				resolve(false);
				return;
			}
			resolve(self.changeName(data._id, newName));
		});
	});
}

/* Moves a file located at path
 * @param path       : implicit path of the file
 * @parma parentPath : new parent path 
 */
ThingsDatabase.prototype.moveFileFromPath = function(path, parentPath){
	var self = this;
	return new Promise(function(resolve, reject){
		self.viewFileObject(path).then(function(data){
			if(!data){
				resolve(false);
				return;
			}
			self.viewFileObject(parentPath).then(function(parentData){
				self._staleCache()
				if(!parentData){
					resolve(false);
					return;
				}
				self._staleCache(path);
				self._staleCache(parentPath);
				resolve(self.moveFile(data._id, parentData._id));
			});
		});
	});
}


module.exports = ThingsDatabase;

