import * as vscode from 'vscode';

import cp = require('child_process');
import internal = require('stream');
import os = require('os');
import path = require('path');
import fs = require('fs')
import ver = require('compare-versions');

const minCLIVersion = "0.2.0";

// this method is called when extension is activated
export function activate(context: vscode.ExtensionContext) {
	let disposable = vscode.commands.registerCommand('rhinocode.runInRhino', () => {
		const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;

		let configs = vscode.workspace.getConfiguration('rhinocode');
		let showActiveDocument = configs.get<boolean>("showActiveDocument");
		let showActiveViewport = configs.get<boolean>("showActiveViewport");
		let showProcessId = configs.get<boolean>("showProcessId");
		let showProcessAge = configs.get<boolean>("showProcessAge");

		if (activeFile != undefined) {
			const rhinos = getRhinoInstances();
			if (rhinos.length > 0) {
				const names = new Map(
					rhinos.map(r => {
						let title = `${r.processName} ${r.processVersion}`;
						if (showProcessId)
							title += ` <${r.processId}>`;

						if (showActiveDocument) {
							if (r.activeDoc.title == undefined) {
								title += ` - "Untitled - Not Saved"`;
							}
							else {
								title += ` - "${r.activeDoc.title}" @ ${r.activeDoc.location}`;
							}
						}

						if (showActiveViewport)
							title += ` [${r.activeViewport}]`;

						if (showProcessAge)
							title += ` (${r.processAge} Minutes)`;

						return [title, r]
					})
				);

				vscode.window.showQuickPick([...names.keys()], { canPickMany: false })
					.then((v) => {
						if (v != undefined) {
							const rhino = names.get(v);
							const scriptCmd = `${getRhinoCode()} --rhino ${rhino?.pipeId} script \"${activeFile}\"`;
							console.log(scriptCmd)
							cp.execSync(scriptCmd);
						}
					});
			}
		}
		else {
			vscode.window.showInformationMessage(
				"There are no active scripts open"
			);
		}
	});

	context.subscriptions.push(disposable);
}

// this method is called when extension is deactivated
export function deactivate() { }

interface RhinoInstance {
	readonly pipeId: string;
	readonly processId: number;
	readonly processName: string;
	readonly processVersion: string;
	readonly processAge: number;
	readonly activeDoc: RhinoDocument;
	readonly activeViewport: string;
}

interface RhinoDocument {
	readonly title: string;
	readonly location: string;
}

function getRhinoInstances(): Array<RhinoInstance> {
	const rc = getRhinoCode();
	if (rc != undefined) {
		const stdout = cp.execSync(`${rc} list --json`);
		const rhinos: Array<RhinoInstance> = JSON.parse(stdout.toString());
		if (rhinos.length == 0) {
			vscode.window.showErrorMessage(
				"There are no instance of Rhino WIP running"
			);
		}
		return rhinos;
	}
	else {
		return [];
	}
}

function getRhinoCode(): string | void {
	let configs = vscode.workspace.getConfiguration('rhinocode');
	let rhinoPathConfig = configs.get<string>("rhinoInstallPath", "");

	if (rhinoPathConfig != undefined) {
		const rhinoPaths = rhinoPathConfig.split(';');
		for (let p in rhinoPaths) {
			let rhinoPath = rhinoPaths[p].trim();
			let rhinocodePath;
			switch (os.platform()) {
				case 'darwin':
					rhinocodePath = `${rhinoPath}/Contents/Resources/bin/rhinocode`;
					break;
				case 'win32':
					rhinocodePath = `${rhinoPath}/RhinoCode.exe`
					break;
			}

			if (rhinocodePath != undefined) {
				try {
					rhinocodePath = path.normalize(rhinocodePath);
					if (fs.statSync(rhinocodePath) != undefined) {
						const stdout = cp.execSync(`${rhinocodePath} --version`);
						if (ver.compare(stdout.toString().trimEnd(), minCLIVersion, '>=')) {
							return rhinocodePath;
						}
						else {
							vscode.window.showErrorMessage(
								`Minimum required rhinocode is \"${minCLIVersion}\". Please install the latest Rhino WIP`
							);
						}
					}
					else {
						vscode.window.showErrorMessage(
							"Can not find rhinocode. Make sure Rhino install path is set in this extension settings"
						);
					}
				}
				catch (_ex) {
					console.log(`Error checking rhinocode path ${rhinocodePath} | ${_ex}`)
				}
			}
		}
	}
}