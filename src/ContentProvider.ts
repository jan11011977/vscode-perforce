import { window, workspace, Uri, Disposable, Event, EventEmitter } from 'vscode';
import { Utils } from './Utils';
import { Display } from './Display';

export class PerforceContentProvider {
    private onDidChangeEmitter = new EventEmitter<Uri>();
    get onDidChange(): Event<Uri> { return this.onDidChangeEmitter.event; }

    private disposables: Disposable[] = [];
    dispose(): void { this.disposables.forEach(d => d.dispose()); }

    private compatibilityMode: string;

    constructor(compatibilityMode: string) {
        this.compatibilityMode = compatibilityMode;
        this.disposables.push(
            workspace.registerTextDocumentContentProvider('perforce', this),
        );
    }

    public provideTextDocumentContent(uri: Uri): Promise<string> {
        return new Promise<string>((resolve) => {
            let command: string = uri.authority;
            let file = uri.fsPath ? Uri.file(uri.fsPath) : null;
            let revision: string = decodeURIComponent(uri.fragment);
            let args: string = decodeURIComponent(uri.query);

            if (!file) {
                // Try to guess the proper workspace to use
                if (window.activeTextEditor && !window.activeTextEditor.document.isUntitled) {
                    const resource = window.activeTextEditor.document.uri;
                    return Utils.runCommand(window.activeTextEditor.document.uri, command, null, revision, args).then(resolve);
                } else if (workspace.workspaceFolders) {
                    const resource = workspace.workspaceFolders[0].uri;
                    return Utils.runCommand(resource, command, null, revision, args).then(resolve);
                } else {
                    throw new Error(`Can't find proper workspace for command ${command} `);
                }
            } else {
                return Utils.runCommandForFile(command, file, revision, args).then(resolve);
            }
            
        }).catch(reason => {
            Display.showError(reason.toString());
            return '';
        });
    }
}