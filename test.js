var assert = require('assert');
var downloader = require('./index.js');
var path = require('path');
var fs = require('fs');
var rimraf = require('rimraf');
var buffer = require('buffer');
var mkdirp = require('mkdirp');
var crypto = require('crypto');

var rand = Math.floor(Math.random() * (1 << 24)).toString(16);

describe('paths', function() {
  it('should have a settable download cache path property', function() {
    assert.equal(downloader.downloadCache, '/tmp');

    var dlPath = '/tmp/'+rand

    downloader.downloadCache = dlPath

    assert.equal(downloader.downloadCache, dlPath);
  });

  it('should have a settable module path property', function() {
    assert.equal(downloader.modulePath, '../installed');

    var modulePath = '/tmp/'+rand+'/bundled'

    downloader.modulePath = modulePath;

    assert.equal(downloader.modulePath, modulePath);
  });
});


describe('downloader', function() {
  var dlPath = '/tmp/'+rand
  var modulePath = '/tmp/'+rand+'/installed'
  var bundlePath = '/tmp/'+rand+'/bundled'

  beforeEach(function(done) {
    downloader.downloadCache = dlPath;
    downloader.modulePath = modulePath;
    downloader.bundlePath = bundlePath;
    mkdirp(dlPath, function(err) {
      mkdirp(path.join(dlPath, 'Audio'), function(err) {
        if (err) throw err;
        done();
      });
    });
  });

  afterEach(function(done) {
    rimraf(dlPath, function(err) {
      if (err) throw err;
      done()
    });
  });

  describe('downloadModuleToDevice', function() {

    it('should exist', function() {
      assert(downloader);
    });

    it('should download a module', function(done) {
      this.timeout(5000);

      var module = JSON.parse(fs.readFileSync('./test/module.json').toString());

      var dlPath = '/tmp/'+rand

      rimraf.sync(dlPath); // blow away the test dir to make sure it's properly created by the downloader

      downloader.downloadCache = dlPath

      downloader.downloadModuleToDevice(module, function(err) {
        assert.equal(err, null);
        assert(fs.existsSync(path.join(dlPath, '0c656b87d8f8214bfd9bb724107ab454a6cf52676f85886dd6070f9773b88dd6')));
        assert(fs.existsSync(path.join(dlPath, 'c48ecae2dd4017f8909d80e913ddeb582d93e5a301203a0a9cbc46cf5187b4a6')));
        done()
      });
    })

    it('should update the progress indicators', function(done) {
      this.timeout(5000);

      var module = JSON.parse(fs.readFileSync('./test/module.json').toString());

      module.files = [module.files[0]];

      var dlPath = '/tmp/'+rand;

      var lastBytes = 0;

      var fileEmitted = false;

      downloader.downloadCache = dlPath;

      var listener = function() {
        fileEmitted = true;
        assert.notEqual(downloader.progress.bytes, lastBytes);
        lastBytes = downloader.progress.bytes;
      };
      downloader.on('file', listener);

      downloader.downloadModuleToDevice(module, function(err) {
        assert.equal(err, null);
        assert(fileEmitted);
        downloader.removeListener('file', listener);
        done()
      });
    });

    it('should not download the same file twice for two different modules', function(done) {
      var module1 = JSON.parse(fs.readFileSync('./test/module.json').toString());
      var module2 = JSON.parse(fs.readFileSync('./test/module.json').toString());
      module2._id = 'foo';

      var targetFile = module1.files[0].sha

      downloader.downloadModuleToDevice(module1, function(err) {
        assert.equal(err, null);
        var stats = fs.statSync(path.join(dlPath, targetFile));
        setTimeout(function() {
          downloader.downloadModuleToDevice(module2, function(err) {
            assert.equal(err, null);
            var innerStats = fs.statSync(path.join(dlPath, targetFile));
            assert.equal(innerStats.mtime.toString(), stats.mtime.toString());
            done();
          });
        }, 1000);
      });
    });

    it('should store a file with its sha as the filename', function(done) {
      this.timeout(5000);

      var module = JSON.parse(fs.readFileSync('./test/module.json').toString());

      var dlPath = '/tmp/'+rand

      rimraf.sync(dlPath); // blow away the test dir to make sure it's properly created by the downloader

      downloader.downloadCache = dlPath

      downloader.downloadModuleToDevice(module, function(err) {
        assert.equal(err, null);
        module.files.forEach(function(file) {
          assert(fs.existsSync(path.join(dlPath, file.sha)));
        });
        done()
      });
    });

  });

  describe('cacheCheck', function() {

    it('should return complete when a module is downloaded and intact', function(done) {
      var files = [
        {
          "localName": "index.html",
          "localPath": "/",
          "file": "542b586ace13450200190113",
          "_id": "542b94dbb8058702003f0e3c",
          "__v": 0,
          "md5": "c9e41a13832d7062fc8a3604d715e45a",
          "sha": "0c656b87d8f8214bfd9bb724107ab454a6cf52676f85886dd6070f9773b88dd6",
          "url": "https://basefactory-test.s3.amazonaws.com/0c656b87d8f8214bfd9bb724107ab454a6cf52676f85886dd6070f9773b88dd6",
          "size": 258
        }
      ]

      var testFile = files[0];

      var testFilePath = path.join(dlPath, testFile.sha);

      mkdirp.sync(path.dirname(testFilePath));

      fs.writeFileSync(testFilePath, fs.readFileSync('./test/index.html'));

      downloader.cacheCheck(files, function(err, complete) {
        assert.equal(err, null);
        assert.equal(complete, true);
        done()
      });
    });

    it('should return incomplete when a module is not fully downloaded', function(done) {
      var files = [
        {
          "localName": "index.html",
          "localPath": "/",
          "file": "542b586ace13450200190113",
          "_id": "542b94dbb8058702003f0e3c",
          "__v": 0,
          "md5": "c9e41a13832d7062fc8a3604d715e45a",
          "sha": "0c656b87d8f8214bfd9bb724107ab454a6cf52676f85886dd6070f9773b88dd6",
          "url": "https://basefactory-test.s3.amazonaws.com/0c656b87d8f8214bfd9bb724107ab454a6cf52676f85886dd6070f9773b88dd6",
          "size": 258
        }
      ]

      var testFile = files[0];

      var testFilePath = path.join(dlPath, testFile.sha);

      mkdirp.sync(path.dirname(testFilePath));

      var buf = new Buffer(parseInt(testFile.size));

      fs.writeFileSync(testFilePath, buf);

      assert.equal(fs.statSync(testFilePath).size, testFile.size);

      downloader.cacheCheck(files, function(err, complete) {
        assert.equal(err, null);
        assert.equal(complete, false);
        done()
      });
    });
  });

  describe('copyModuleIntoPlace', function() {
    it('should copy a module into place once downloaded', function(done) {
      var module = JSON.parse(fs.readFileSync('./test/module.json').toString());

      downloader.downloadCache = dlPath;
      downloader.modulePath = modulePath;

      downloader.downloadModuleToDevice(module, function(err) {
        assert.equal(err, null);
        downloader.copyModuleIntoPlace(module, function(err) {
          assert(fs.existsSync(path.join(modulePath, module._id, 'audio', 'ice_cream.mp3')));
          assert(fs.existsSync(path.join(modulePath, module._id, 'images', 'cat.jpg')));
          assert(fs.existsSync(path.join(modulePath, module._id, 'index.html')));
          done()
        });
      });

    });
  });

  describe('removeModuleFromDevice', function() {
    it('should remove the module files', function(done) {
      var innerRand = Math.floor(Math.random() * (1 << 24)).toString(16);
      var moduleId = 'test'+innerRand
      var modPath = path.join(modulePath, moduleId);
      mkdirp.sync(modPath);
      downloader.removeModuleFromDevice(moduleId, function(err) {
        assert.equal(err, null);
        assert(!fs.existsSync(modPath));
        done()
      });
    });
  });

  describe('cancelDownload', function() {
    it('should cancel the current download', function(done) {
      var module = JSON.parse(fs.readFileSync('./test/module.json').toString());

      downloader.on('aborted', function(){
        done();
      });

      downloader.downloadModuleToDevice(module, function(err) {
        assert.equal(err.message, 'Download aborted');
      });

      setTimeout(function() {
        downloader.cancelDownload(function(err) {
          assert.equal(err, null);
        });
      }, 10);

    });
  });

  describe('moduleInfo', function() {
    it('should return information about a module', function(done) {
      var moduleId = Math.floor(Math.random() * (1 << 24)).toString(16);

      mkdirp.sync(path.join(bundlePath, moduleId));
      mkdirp.sync(path.join(modulePath, moduleId));

      //write bundled
      var version = JSON.stringify({version: "0.1.0"});
      fs.writeFileSync(path.join(bundlePath, moduleId, 'version.json'), version);

      // write installed
      version = JSON.stringify({version: "0.0.0"});
      fs.writeFileSync(path.join(modulePath, moduleId, 'version.json'), version);

      downloader.moduleInfo(moduleId, function(err, info) {
        assert.equal(err, null);
        assert.equal(info.installed.version, "0.0.0");
        assert.equal(info.bundled.version, "0.1.0");
        done();
      });
    });
  });

  describe('bundleInit', function() {
    it('should move bundled files into the downloadCache', function(done) {
      var moduleId = Math.floor(Math.random() * (1 << 24)).toString(16);

      var destPath = path.join(bundlePath, moduleId, 'index.html');

      mkdirp.sync(path.dirname(destPath));

      fs.createReadStream('./test/index.html').pipe(fs.createWriteStream(destPath)).on('close', function() {

        downloader.bundleInit(function(err) {
          assert.equal(err, null);
          assert(fs.existsSync(dlPath+'/0c656b87d8f8214bfd9bb724107ab454a6cf52676f85886dd6070f9773b88dd6'));
          done();
        });
      });
    });
  });
});
