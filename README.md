# Optimize your NodeJS/NPM installation

Compile your NodeJS (including NPM) machine installation.

## Installation
```bash
npm install -g optimizeme
```

## Help

```bash
$ node index.js --help

  Usage: index [options] [command]


  Commands:

    nodejs               Optimize NodeJS libraries
    npm                  Optimize NPM libraries
    all                  Optimize All libraries
    restore <directory>  Restore directory

  Options:

    -h, --help         output usage information
    -c, --cores [num]  Set number of cores for compilation

  Examples:

    $ optimizeme nodejs         Optimize NodeJS
    $ optimizeme npm            Optimize NPM

  optimizeme v1.0.0 (c) 2017 - Michael Vergoz
```
