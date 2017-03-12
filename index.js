const EventEmitter = require('events');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const program = require('commander');
const prettyjson = require('prettyjson');
const ClosureCompiler = require("google-closure-compiler").compiler;
const child_process = require("child_process");
const jen = new (require("node-jen"))();

const magic = "//-------------------------------------------OPTIMIZEME-V1.0\n";
var compilationThreads = os.cpus().length;
var cacheDir = __dirname+'/cache';
var backupDir = __dirname+'/backup';

console.pretty = function(data) {
	console.log(prettyjson.render(data));
}

console.debug = console.log;
console.error = console.log;

/* */
var fileList = [];
var fileHash = {};
var pathHash = {};
var result = {
  codeSizeOrginal: 0,
  codeSizeOptimized: 0
}

/* read package */
try {
  var pack = JSON.parse(fs.readFileSync(__dirname+'/package.json'))
} catch(e) {
	console.log('Can not read package.json: '+e.message)
	process.exit(-1);
}

function mkdirDeep(dir) {
	var stage = '';
	var tab = dir.split("/");
	tab.pop();

	for(var a = 1; a<tab.length; a++) {
		stage += '/'+tab[a];
		try  {
			try {
				var fss = fs.statSync(stage);
			} catch(a) {
				fs.mkdirSync(stage);
			}
		}
		catch(e) {
			console.error('* Error: can not create '+dir);
			process.exit(0);
		}
	}
	return(true);
};

function copyMagic(src, dst, end, noMagic) {
  var s = fs.createReadStream(src);
  s.on('open', () => {
    var d = fs.createWriteStream(dst);
    if(!noMagic)
      d.write(magic);
    d.on('error', (e) => {
      console.error("Can not write "+dst+": "+e.message);
    })
    s.on('end', () => {
      if(end) end();
    })
    s.pipe(d);
  })

}

function copyCacheToSrc(file, end) {
  var cacheFile = cacheDir+'/'+fileHash[file]+'.cache';
  copyMagic(cacheFile, file, end);
}

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 *
 *
 * First stage follow dirs
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */
function followLeaf(path, leaf, end, noMeCheck) {
  var isMe = false;
  if(noMeCheck != true && path.substr(0, __dirname.length) == __dirname)
    isMe = true;

  if(isMe == false) {
    try {
      var fss = fs.statSync(path);
      if(fss.isFile()) {
        var f = path.split('.');
        f = f[f.length-1];
        if(f == 'js' && leaf) {
          result.codeSizeOrginal += fss.size;
          leaf(path)
        }
      }
      else if(fss.isDirectory()) {
        var dirs = fs.readdirSync(path);
        for(var a in dirs) {
          var d = dirs[a];
          followLeaf(path+'/'+d, leaf, true, noMeCheck);
        }
      }
    } catch(e) { console.log('Error reading '+path+': '+e.message) }
  }

  if(leaf && !end)
    leaf(null)
}

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 *
 *
 *
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */
function startMagic(end) {
  var newList = [];

  function popper() {
    var file = fileList.pop();
    if(!file) {
      fileList = newList;
      if(end) end();
      return;
    }

    // open and read first bytes
    fs.open(file, 'r', function(status, fd) {
      if(status) {
        console.log(status.message);
        return;
      }

      var buffer = new Buffer(magic.length);
      fs.read(fd, buffer, 0, magic.length, 0, function(err, num) {
        var m = buffer.toString('utf8', 0, num);

        if(m.substr(0, 2) == '#!') {
          console.debug("Skipping "+file+' because of Preloader interpreter')
        }
        // check for the magic
        else if(m != magic) {
          // compute pathHash
          var c = crypto.createHash("md5");
          c.update(file);
          pathHash[file] = c.digest('hex');

          // push
          newList.push(file);
        }

        process.nextTick(popper);
      });
    });

  }

  setTimeout(popper, 100);
}

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 *
 *
 *
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */
function startHash(end) {
  var newList = [];

  function popper() {
    var file = fileList.pop();
    if(!file) {
      fileList = newList;
      if(end) end();
      return;
    }

    var d = fs.createReadStream(file);
    var c = crypto.createHash('md5');
    d.on('data', (data) => {
      c.update(data);
    })
    d.on('end', () => {
      fileHash[file] = c.digest('hex');
      newList.push(file);
      process.nextTick(popper);
    })

    console.debug('Hashing '+file);
  }

  setTimeout(popper, 100);
}

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 *
 *
 *
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */
function startCacheCheck(end) {
  var newList = [];

  function popper() {
    var file = fileList.pop();
    if(!file) {
      fileList = newList;
      if(end) end();
      return;
    }

    var cacheFile = cacheDir+'/'+fileHash[file]+'.cache';

    fs.stat(cacheFile, (err, fss) => {
      if(err) {
        newList.push(file);
        console.debug('No cache for '+file);
        process.nextTick(popper);
      }
      else {
        console.debug('Using cache for '+file);
        copyCacheToSrc(file, () => {
          process.nextTick(popper);
        });
      }

    })


  }

  setTimeout(popper, 100);
}

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 *
 *
 *
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */
var popped = 0;
function startClosure(end) {
  var newList = [];

  var total = fileList.length;
  function popper() {
    var file = fileList.pop();
    if(!file) {
      fileList = newList;
      if(end) end();
      return;
    }
    var fh = fileHash[file];
    var cacheFile = cacheDir+'/'+fh+'.cache';

    /* executing google closure */
    var gcopts = {
      js: file,
      compilation_level: 'SIMPLE',
      js_output_file: cacheFile,
    }

    popped++;

    console.debug('Compiling '+file+' '+popped+'/'+total);

    // early cache selection
    var cacheFile = cacheDir+'/'+fileHash[file]+'.cache';

    fs.stat(cacheFile, (err, fss) => {
      if(!err) {
        copyCacheToSrc(file, () => {
          process.nextTick(popper);
        });
        return;
      }

      var closureCompiler = new ClosureCompiler(gcopts);

      var compilerProcess = closureCompiler.run(function(exitCode, stdOut, stdErr) {
        fs.writeFileSync(cacheFile+'.errLog', stdErr);

        try {
          var s = fs.statSync(cacheFile);
        } catch(e) {
          s = null;
        }

        if(!s) {
          console.log('Closure error on '+file);
          copyMagic(file, cacheFile, () => {
            process.nextTick(popper);
          }, true);
        }
        else {
          copyCacheToSrc(file, () => {
            process.nextTick(popper);
          });
        }
      });
    })
  }

  setTimeout(popper, 100);
}


 /* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
  *
  *
  *
  * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */
 function startBackup(end) {
   var newList = [];

   function popper() {
     var file = fileList.pop();
     if(!file) {
       fileList = newList;
       if(end) end();
       return;
     }

     var backupFile = backupDir+file;

     console.debug('Backup file '+file+' in '+backupFile);

     mkdirDeep(backupFile)

     var s = fs.createReadStream(file);
     var d = fs.createWriteStream(backupFile);

     s.on('end', () => {
       newList.push(file);
       process.nextTick(popper);
     })
     s.pipe(d);
   }

   setTimeout(popper, 100);
 }

function starter(end) {
  var counter = compilationThreads;
  if(program.cores)
    counter = program.cores;

  var ran = 0;
  startMagic(() => {
    startBackup(() => {
      startHash(() => {
        mkdirDeep(cacheDir+'/pad');
        startCacheCheck(() => {
          for(var ran=0; ran<counter; ran++) {
            startClosure(() => {
              ran--;
              if(ran == 0 && end)
                end();
            });
          }
        });
      });
    });
  });
}

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 *
 *
 * NodeJS command
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */
function nodejs(end) {

  followLeaf('/usr/lib/nodejs', (filename) => {
    if(!filename) {
      console.debug('Scan done');
      starter(() => {
        if(end) end();
        console.pretty(result);
      });
      return;
    }

    fileList.push(filename);
  });
}

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 *
 *
 * NPM command
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */
function npm(end) {
  followLeaf('/usr/lib/node_modules', (filename) => {
    if(!filename) {
      console.debug('Scan done');
      starter(() => {
        if(end) end();
        console.pretty(result);
      });
      return;
    }

    fileList.push(filename);
  });
}

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 *
 *
 * nodejs/NPM command
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */
function all() {
  nodejs(() => {
      npm();
  });
}

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 *
 *
 * compile a special directory
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */
function compile(directory) {
  followLeaf(directory, (filename) => {
    if(!filename) {
      console.debug('Scan done');
      starter(() => {
        console.pretty(result);
      });
      return;
    }
    fileList.push(filename);
  });
}

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 *
 *
 * Restore command
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */
function restore(directory) {

  fs.stat(directory, (err, fss) => {
    if(!fss.isDirectory()) {
      console.log(directory+" is not a directory")
      process.exit(-1);
    }

    var bd = backupDir+directory;
    function doRestore(end) {

      function popper() {
        var file = fileList.pop();
        if(!file) {
          if(end) end();
          return;
        }

        var srcFile = backupDir+directory+file;
        var dstFile = directory+file;
        console.debug('Restoring file '+dstFile+' from '+srcFile);

        mkdirDeep(dstFile)
        var s = fs.createReadStream(srcFile);
        var d = fs.createWriteStream(dstFile);
        d.on('error', (e) => {
          console.error("Can not write "+dstFile+": "+e.message);
        })
        s.on('end', () => {
          process.nextTick(popper);
        })
        s.pipe(d);
      }

      setTimeout(popper, 100);
    }

    followLeaf(bd, (filename) => {
      if(!filename) {
        console.debug('Restore scanner done');
        setTimeout(doRestore, 100, () => {
          console.debug("Restore completed")
        })
        return;
      }
      filename = filename.substr(bd.length, filename.length-bd.length)
      fileList.push(filename);
    }, false, true);
  })
}

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 *
 *
 * Program definition
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */
program
  .command('nodejs')
  .description('Optimize NodeJS libraries')
  .action(nodejs);

program
  .command('npm')
  .description('Optimize NPM libraries')
  .action(npm);

program
  .command('all')
  .description('Optimize All libraries')
  .action(all);

program
  .command('compile <directory>')
  .description('Compile directory')
  .action(compile);

program
  .command('restore <directory>')
  .description('Restore directory')
  .action(restore);

program.option('-c, --cores [num]', 'Set number of cores for compilation');

program.on('--help', function(){
  console.log('  Examples:');
  console.log('');
  console.log('    $ optimizeme nodejs         Optimize NodeJS');
  console.log('    $ optimizeme npm            Optimize NPM');
  console.log('');
	console.log('  optimizeme v'+pack.version+' (c) 2017 - Michael Vergoz');
	console.log('');
});

program.parse(process.argv);
