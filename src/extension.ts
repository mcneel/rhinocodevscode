// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import cp = require('child_process');

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	// console.log('Congratulations, your extension "rhinocode" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('rhinocode.runinrhino', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showQuickPick(["Rhino 8 (this doc)", "Rhino 8 (other doc)"], { canPickMany: false })
			.then((v) => {
				if (v != undefined) {
					vscode.window.showInformationMessage(`Chose ${v} option`);

					cp.exec('pwd', (err, stdout, stderr) => {
						console.log('stdout: ' + stdout);
						console.log('stderr: ' + stderr);
						if (err) {
							console.log('error: ' + err);
						}
					});
				}
			});
	});

	context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() { }
