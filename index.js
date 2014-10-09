var EventEmitter = require('events').EventEmitter;
var path = require('path');
var async = require('async');
var _ = require('underscore');
var fs = require('fs');
var mkdirp = require('mkdirp');
var request = require('request');
var crypto = require('crypto');
var rimraf = require('rimraf');

Downloader = function(){
  this.concurrency = 5;
  this.downloadCache = '/tmp';
  this.modulePath = path.join('..', 'installed');
  this.bundlePath = path.join('..', 'bundled');
  this.maxFailures = 3;
  this.currentDls = {};
  return this;
};

Downloader.prototype = EventEmitter.prototype;

Downloader.prototype.updateProgress = function(file, incomplete) {
  if (!this.progress) return new Error("No progress object defined");
  if (incomplete) return this.progress.bytes -= parseInt(file.size);
  this.progress.bytes += parseInt(file.size);
};

Downloader.prototype.downloadFile = function(file, callback) {
  _this = this;
  var destPath = path.join(this.downloadCache, file.sha);

  mkdirp(path.dirname(destPath), function(err) {
    if (err) return callback(err);

    var dest = fs.createWriteStream(destPath);

    dest.on('error', function(err) {
      return callback(err)
    });

    dest.on('finish', function(err) {
      delete _this.currentDls[id];
      return callback(null, file);
    });

    var opts = {uri: file.url};

    if (_this.proxy) {
      var protocol = url.parse(file.url).protocol;
      opts.proxy = protocol+'//'+_this.proxy;
    }

    var source = request(opts);

    source.on('error', function(err) {
      return callback(err);
    });

    var id = Math.floor(Math.random() * (1 << 24)).toString(16);

    _this.currentDls[id] = source;

    source.pipe(dest);
  });
};

Downloader.prototype.downloadModuleToDevice = function(module, callback) {
  var that = this;
  
  var files = module.files;
  
  var totalSize = 0;

  files.forEach(function(file) {
    totalSize += file.size;
  });

  this.progress = {
    bytes: 0,
    totalSize: totalSize
  };

  var errs = [];

  var aborted = false;

  this.on('abort', function() {
    aborted = true;
    return callback(new Error('Download aborted'));
  });

  var queue = async.queue(function(file, callback) {
    if (aborted) return callback();

    var destPath = [that.downloadCache, file.sha].join('/');

    that.checkFile(file, function(err, comp) {
      if (err) {
        errs.push(err);
        return callback();
      }

      if (comp) {
        that.updateProgress(file, false);
        that.emit('file', file);
        return callback();
      };

      that.downloadFile(file, function(err) {
        if (err) {
          console.error('error while downloading file', err, file);
          errs.push(err);
          return callback();
        };

        that.updateProgress(file, false);
        that.emit('file', file);

        return callback();
      });

    });

  }, this.concurrency);

  queue.drain = function() {
    if (aborted) return;
    that.removeAllListeners('abort');
    if (errs.length === 0) {
      return callback(null);
    } else {
      return callback(errs);
    }
  };

  files.forEach(function(file) {
    queue.push(file);
  });
};

Downloader.prototype.hashFile = function(filePath, cipher, callback) {
  if (typeof cipher === 'function') {
    callback = cipher;
    cipher = 'md5';
  };

  var sum = crypto.createHash(cipher);

  fs.readFile(filePath, function(err, data) {
    if (err && err.code === 'EISDIR') return callback(null, null);
    sum.update(data);
    callback(null, sum.digest('hex'));
  });
};

Downloader.prototype.checkFile = function(file, callback) {
  var _this = this;
  var destPath = path.join(this.downloadCache, file.sha);

  var complete = true;
  var outerErr;

  fs.exists(destPath, function(exists) {
    if (!exists) return callback(null, false);

    _this.hashFile(destPath, function(err, hash) {
      if (err) return callback(err);
      if ( hash !== file.md5 ) complete = false;
      callback(null, complete);
    });

  });
};

Downloader.prototype.cacheCheck = function(files, callback) {
  var that = this;

  var errs = [];
  var complete = true;

  var queue = async.queue(function(file, callback) {
    that.checkFile(file, function(err, comp) {

      if (err) errs.push(err);
      if (!comp) {
        complete = false;
        that.updateProgress(file, true);
      }
      callback();
    });

  }, 5);

  queue.drain = function() {
    if (errs.length === 0) errs = null;
    callback(errs, complete);
  };

  _.each(files, function(file) {
    queue.push(file);
  }, this);
};

Downloader.prototype.copyModuleIntoPlace = function(module, callback) {
  var _this = this;
  var dest = path.join(this.modulePath, module._id);

  var moveFile = function(file, callback) {
    var destFileName = path.join(dest, file.localPath, file.localName);
    mkdirp(path.dirname(destFileName), function(err) {
      var destFile = fs.createWriteStream(destFileName);
      var sourceFile = fs.createReadStream(path.join(_this.downloadCache, file.sha));
      destFile.on('close', function() {
        return callback(null);
      });
      destFile.on('error', function(err) {
        return callback(err);
      });
      sourceFile.pipe(destFile);
    });
  };

  async.eachSeries(module.files, moveFile, callback);
};

Downloader.prototype.removeModuleFromDevice = function(moduleId, callback) {
	rimraf(path.join(this.modulePath, moduleId), callback);
};

Downloader.prototype.cancelDownload = function(callback) {
  if (!callback) callback = function(){};
  this.emit('abort');

  var closed = 0;

  _.each(this.currentDls, function(currentDl) {
    currentDl.abort();
  });

  this.emit('aborted');
  callback();
};

Downloader.prototype.moduleInfo = function(moduleId, callback) {
  var that = this;

  var fetchInfo = function(target, callback) {
    fs.readFile(path.join(target, 'version.json'), function(err, data) {
      if (err && err.code === 'ENOENT') return callback(null, null);
      if (err) return callback(err, null);
      if (!data.toString()) return callback(null, null);
      try {
        var info = JSON.parse(data.toString());
      } catch (e) {
        err = e;
      }
      callback(err, info);
    });
  };

  async.parallel({
    installed: function(callback) {
      var targetPath = path.join(that.modulePath, moduleId);
      fetchInfo(targetPath, callback);
    },
    bundled: function(callback) {
      var targetPath = path.join(that.bundlePath, moduleId);
      fetchInfo(targetPath, callback);
    }
  }, callback);
};

Downloader.prototype.bundleInit = function(callback) {
  var that = this;

  var copyBundledFileToCache = function(from, callback) {
    that.hashFile(from, 'sha256', function(err, hash) {
      if (err || !hash) return callback(err);
      var source = fs.createReadStream(from);
      var dest = fs.createWriteStream(path.join(that.downloadCache, hash));
      dest.on('close', callback);
      dest.on('error', callback);
      source.pipe(dest);
    });
  };

  var copyBundledModuleToCache = function(localPath, callback) {
    var files = fs.readdir(localPath, function(err, files) {
      if (err) return callback(err);
      files = files.map(function(file) {
        return path.join(localPath, file);
      });
      async.eachSeries(files, copyBundledFileToCache, callback);
    });
  };

  fs.readdir(this.bundlePath, function(err, files) {
    if (err) return callback(err);
    if (files.length === 0) return callback(null);
    files = files.map(function(file) {
      return path.join(that.bundlePath, file);
    });

    async.eachSeries(files, copyBundledModuleToCache, callback);
  });
};

module.exports = new Downloader();
