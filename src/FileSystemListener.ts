'use strict'

import {
    window,
    workspace,
    Disposable,
    FileSystemWatcher,
    TextDocument,
    TextDocumentChangeEvent,
    RelativePattern,
    Uri,
    WorkspaceFolder
} from 'vscode';

import * as Path from 'path';
import * as micromatch from 'micromatch';
import * as parseignore from 'parse-gitignore';

import {Display} from './Display';
import {PerforceCommands} from './PerforceCommands';
import {PerforceService} from './PerforceService';

export default class FileSystemListener
{
    private static _eventRegistered: boolean = false;
    private static _lastCheckedFileUri?: Uri = null;

    private _disposable: Disposable;
    private _watcher: FileSystemWatcher;

    private _p4ignore: string[];

    constructor(workspaceFolder: WorkspaceFolder) {
        const subscriptions: Disposable[] = [];
        window.onDidChangeActiveTextEditor(Display.updateEditor, this, subscriptions);

        var config = workspace.getConfiguration('perforce');

        if(config && PerforceCommands.checkFolderOpened()) {

            if (!FileSystemListener._eventRegistered) {
                if(config['editOnFileSave']) {
                    workspace.onWillSaveTextDocument(e => {
                        e.waitUntil(FileSystemListener.onWillSaveFile(e.document));
                    });
                }
                
                if(config['editOnFileModified']) {
                    workspace.onDidChangeTextDocument(FileSystemListener.onFileModified);
                }
                FileSystemListener._eventRegistered = true;
            }

            if(config['addOnFileCreate'] || config['deleteOnFileDelete']) {
                let pattern = new RelativePattern(workspaceFolder ? workspaceFolder : '', '**/*');
                this._watcher = workspace.createFileSystemWatcher(pattern, false, true, false);

                if(config['addOnFileCreate']) {
                    this._watcher.onDidCreate(this.onFileCreated, this, subscriptions);
                }

                if(config['deleteOnFileDelete']) {
                    this._watcher.onDidDelete(this.onFileDeleted, this, subscriptions);
                }
            }
        }

        this._p4ignore = [];

        let p4IgnoreFileName = process.env.P4IGNORE;
        if (!p4IgnoreFileName) {
            p4IgnoreFileName = '.p4ignore';
        }
        let pattern = new RelativePattern(workspaceFolder ? workspaceFolder : '', p4IgnoreFileName);
        workspace.findFiles(pattern, undefined, 1).then((result) => {
            if (result && result.length > 0) {
                this._p4ignore = parseignore(result[0].fsPath);
            }
        });

        this._disposable = Disposable.from.apply(this, subscriptions);
    }

    public dispose() {
        this._disposable.dispose();
    }

    private static onWillSaveFile(doc: TextDocument): Promise<boolean> {
        return FileSystemListener.tryEditFile(doc.uri);
    }

    private static onFileModified(docChange: TextDocumentChangeEvent) {
        var docUri = docChange.document.uri;

        //If this doc has already been checked, just returned
        if (FileSystemListener._lastCheckedFileUri != null && docUri.toString() == FileSystemListener._lastCheckedFileUri.toString()) {
            return;
        }

        //Only try to open files open in the editor
        var editor = window.activeTextEditor;
        if (!editor || !editor.document || editor.document.uri.toString() != docUri.toString()) {
            return;
        }

        FileSystemListener._lastCheckedFileUri = docUri;
        FileSystemListener.tryEditFile(docUri);
    }

    // Had to streamline this, since `onWillSaveTextDocument` allows to delay
    // the save operation only for a few seconds. The time limit should be
    // configurable and/or the operation should be cancellable
    // in future releases.
    // https://github.com/stef-levesque/vscode-perforce/issues/110
    private static tryEditFile(uri: Uri): Promise<boolean> {
        return PerforceCommands.edit(uri, Path.dirname(uri.fsPath));
        // return new Promise((resolve) => {
        //     //Check if this file is in client root first
        //     FileSystemListener.fileInClientRoot(uri).then((inClientRoot) => {
        //         if (inClientRoot) {
        //             return FileSystemListener.fileIsOpened(uri);
        //         }
        //         resolve();
        //     }).then((isOpened) => {
        //         //If not opened, open file for edit
        //         if (!isOpened) {
        //             return PerforceCommands.edit(uri);
        //         }
        //         resolve();
        //     }).then((openedForEdit) => {
        //         resolve();
        //     }).catch((reason) => {
        //         if (reason) Display.showError(reason.toString());
        //         //reject(reason);
        //         resolve();
        //     });
        // });
    }

    private onFileDeleted(uri: Uri) {
        const fileExcludes = Object.keys(workspace.getConfiguration('files').exclude);
        const ignoredPatterns = this._p4ignore.concat(fileExcludes);

        const shouldIgnore: boolean = micromatch.any(uri.fsPath, ignoredPatterns, { dot: true });

        // Only `p4 delete` files that are not marked as ignored either in:
        // .p4ignore
        // files.exclude setting
        if (!shouldIgnore) {
            PerforceCommands.p4delete(uri);
        }
    }

    private onFileCreated(uri: Uri) {
        //Only try to add files open in the editor
        var editor = window.activeTextEditor;
        if(editor && editor.document && editor.document.uri.fsPath == uri.fsPath) {
            PerforceCommands.add(uri);
        }
    }

    private static fileInClientRoot(uri: Uri): Promise<boolean> {
        let docPath = uri.fsPath;
        return new Promise((resolve, reject) => {
            PerforceService.getClientRoot(uri).then((clientRoot) => {
                //Convert to lower and Strip newlines from paths
                clientRoot = clientRoot.toLowerCase().replace(/(\r\n|\n|\r)/gm,"");
                var filePath = docPath.toLowerCase().replace(/(\r\n|\n|\r)/gm,"");

                //Check if p4 Client Root is in uri's path
                if(filePath.indexOf(clientRoot) !== -1) {
                    resolve(true);
                } else {
                    resolve(false);
                }
            }).catch((err) => {
                reject(err);
            });
        });
    }

    private static fileIsOpened(fileUri: Uri): Promise<boolean> {
        return new Promise((resolve, reject) => {
            //opened stdout is set if file open, stderr set if not opened
            PerforceService.executeAsPromise(fileUri, 'opened', fileUri.fsPath).then((stdout) => {
                resolve(true);
            }).catch((stderr) => {
                resolve(false);
            });
        });
    }
}
