class LokiCordovaFSAdapterError extends Error {}

const TAG = "[LokiCordovaFSAdapter]";

class SaveState {

    constructor() {
        this.nextData = null;
        this.callbacks = [];
        this.nextCallbacks = [];
        this._lock = false;
    }

    lock() {
        this._lock = true;
    }

    unlock() {
        this._lock = false;
    }

    isLocked() {
        return this._lock;
    }

    postpone(data, callback) {
        // only the last data matters
        this.nextData = data;
        this.nextCallbacks.push(callback);
    }

    next() {
      var data = this.nextData;

      this.callbacks = this.nextCallbacks;

      this.nextData = null;
      this.nextCallbacks = [];

      return [data, this.callbacks.pop()];
    }

}

class LokiCordovaFSAdapter {
    constructor(options) {
        this.options = options;
        this.saveStates = {};
    }

    getSaveState(dbname) {
        if (!this.saveStates[dbname]) {
            this.saveStates[dbname] = new SaveState();
        }
        return this.saveStates[dbname];
    }

    saveDatabase(dbname, dbstring, callback) {

        var saveState = this.getSaveState(dbname);

        if (saveState.isLocked()) {

            console.log(TAG, "save database already running, postponing");
            saveState.postpone(dbstring, callback);

        } else {
            saveState.lock(dbname);
            console.log(TAG, "saving database");

            this._getFile(dbname,
                (fileEntry) => {
                    fileEntry.createWriter(
                        (fileWriter) => {
                            fileWriter.onwriteend = () => {
                                if (fileWriter.length === 0) {
                                    var blob = this._createBlob(dbstring, "text/plain");
                                    fileWriter.write(blob);
                                    // call all previously defined callbacks and the current one
                                    while (saveState.callbacks.length) {
                                        saveState.callbacks.shift()();
                                    }
                                    callback();

                                    saveState.unlock();

                                    var data, cb = saveState.next();
                                    if (data) {
                                        this.saveDatabase(dbname, data, cb)
                                    }
                                }
                            };
                            fileWriter.truncate(0);
                        },
                        (err) => {
                            console.error(TAG, "error writing file", err);
                            saveState.unlock();
                            throw new LokiCordovaFSAdapterError("Unable to write file" + JSON.stringify(err));
                        }
                    );
                },
                (err) => {
                    console.error(TAG, "error getting file", err);
                    saveState.unlock();
                    throw new LokiCordovaFSAdapterError("Unable to get file" + JSON.stringify(err));
                }
            );
        }
    }

    loadDatabase(dbname, callback) {
        console.log(TAG, "loading database");
        this._getFile(dbname,
            (fileEntry) => {
                fileEntry.file((file) => {
                    var reader = new FileReader();
                    reader.onloadend = (event) => {
                        var contents = event.target.result;
                        if (contents.length === 0) {
                            console.warn(TAG, "couldn't find database");
                            callback(null);
                        }
                        else {
                            callback(contents);
                        }
                    };
                    reader.readAsText(file);
                }, (err) => {
                    console.error(TAG, "error reading file", err);
                    callback(new LokiCordovaFSAdapterError("Unable to read file" + err.message));
                });
            },
            (err) => {
                console.error(TAG, "error getting file", err);
                callback(new LokiCordovaFSAdapterError("Unable to get file: " + err.message));
            }
        );
    }
    
    deleteDatabase(dbname, callback) {
        window.resolveLocalFileSystemURL(cordova.file.dataDirectory,
            (dir) => {
                let fileName = this.options.prefix + "__" + dbname;
                dir.getFile(fileName, {create: true}, 
                    (fileEntry) => {
                        fileEntry.remove(
                            () => {
                                callback();
                            },
                            (err) => {
                                console.error(TAG, "error delete file", err);
                                throw new LokiCordovaFSAdapterError("Unable delete file" + JSON.stringify(err));
                            }
                        );
                    },
                    (err) => {
                        console.error(TAG, "error delete database", err);
                        throw new LokiCordovaFSAdapterError(
                            "Unable delete database" + JSON.stringify(err)
                        );
                    }
                );
            },
            (err) => {
                throw new LokiCordovaFSAdapterError(
                    "Unable to resolve local file system URL" + JSON.stringify(err)
                );
            }
        );
    }

    _getFile(name, handleSuccess, handleError) {
        window.resolveLocalFileSystemURL(cordova.file.dataDirectory,
            (dir) => {
                let fileName = this.options.prefix + "__" + name;
                dir.getFile(fileName, {create: true}, handleSuccess, handleError);
            },
            (err) => {
                throw new LokiCordovaFSAdapterError(
                    "Unable to resolve local file system URL" + JSON.stringify(err)
                );
            }
        );
    }

    // adapted from http://stackoverflow.com/questions/15293694/blob-constructor-browser-compatibility
    _createBlob(data, datatype) {
        let blob;

        try {
            blob = new Blob([data], {type: datatype});
        }
        catch (err) {
            window.BlobBuilder = window.BlobBuilder ||
                    window.WebKitBlobBuilder ||
                    window.MozBlobBuilder ||
                    window.MSBlobBuilder;

            if (err.name === "TypeError" && window.BlobBuilder) {
                var bb = new window.BlobBuilder();
                bb.append(data);
                blob = bb.getBlob(datatype);
            }
            else if (err.name === "InvalidStateError") {
                // InvalidStateError (tested on FF13 WinXP)
                blob = new Blob([data], {type: datatype});
            }
            else {
                // We're screwed, blob constructor unsupported entirely
                throw new LokiCordovaFSAdapterError(
                    "Unable to create blob" + JSON.stringify(err)
                );
            }
        }
        return blob;
    }
}


export default LokiCordovaFSAdapter;
