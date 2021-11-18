import * as vscode from 'vscode';

import cp = require('child_process');
import internal = require('stream');
import os = require('os');
import path = require('path');
import fs = require('fs')

// this method is called when extension is activated
export function activate(context: vscode.ExtensionContext) {
	let disposable = vscode.commands.registerCommand('rhinocode.runinrhino', () => {
		const rhinos = getRhinoInstances();
		const names = new Map(
			rhinos.map(r =>
				[`Rhino ${r.processId} - [${r.activeDoc.title} @ ${r.activeDoc.location}]`, r]
			)
		);
		vscode.window.showQuickPick([...names.keys()], { canPickMany: false })
			.then((v) => {
				if (v != undefined) {
					const rhino = names.get(v);
					const activeFile = vscode.window.activeTextEditor?.document.uri.path;
					const stdout = cp.execSync(`${getRhinoCode()} --rhino ${rhino?.pipeId} script ${activeFile}`);
				}
			});
	});

	context.subscriptions.push(disposable);
}

// this method is called when extension is deactivated
export function deactivate() { }


interface RhinoInstance {
	readonly processId: number;
	readonly pipeId: string;
	readonly activeDoc: RhinoDocument;
}

interface RhinoDocument {
	readonly title: string;
	readonly location: string;
}

function getRhinoInstances(): Array<RhinoInstance> {
	const rhinos: Array<RhinoInstance> = [];

	const rc = getRhinoCode();
	if (rc != undefined) {
		const stdout = cp.execSync(`${rc} list`);

		console.log('stdout: ' + stdout);

		const rhinoDefs = stdout.toString().trimEnd().split('\n').slice(1);
		rhinoDefs.forEach(rd => {
			const rdClean = rd.replace(/\s+/g, ' ').trim();
			let [procId, pipeId, docTitle, docLoc] = rdClean.split(' ');
			rhinos.push(
				{
					processId: parseInt(procId),
					pipeId: pipeId,
					activeDoc: {
						title: docTitle,
						location: docLoc
					}
				}
			)
		});
	}
	else {
		vscode.window.showInformationMessage(
			"Can not find rhinocode. Make sure Rhino install path is set in this extension settings"
		);
	}

	return rhinos;
}

function getRhinoCode(): string | void {
	let configs = vscode.workspace.getConfiguration('rhinocode');
	let rhinoPath = configs.get<string>("rhinoInstallPath", "");
	let rhinocodePath;
	switch (os.platform()) {
		case 'darwin':
			rhinocodePath = `${rhinoPath}/Contents/Resources/bin/rhinocode`;
			break;
		case 'win32':
			rhinocodePath = `${rhinoPath}/System/RhinoCode.exe`
			break;
	}

	if (rhinocodePath != undefined) {
		try {
			rhinocodePath = path.normalize(rhinocodePath);
			if (fs.statSync(rhinocodePath) != undefined) {
				return rhinocodePath;
			}
		}
		catch (_ex) {
			console.log(`Error checking rhinocode path ${rhinocodePath} | ${_ex}`)
		}
	}
}