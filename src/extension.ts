import * as vscode from 'vscode';

import * as Cp from 'child_process';
import * as Os from 'os';
import * as Path from 'path';
import * as Fs from 'fs'
import * as Ver from 'compare-versions';



const Timespan = require("timespan-parser");


// public =====================================================================
export function activate(context: vscode.ExtensionContext) {
	let disposable =
		vscode.commands.registerCommand('rhinocode.runInRhino', runInRhinoCommand);
	context.subscriptions.push(disposable);
}

export function deactivate() { }

// private ====================================================================

// models
type RhinoCodeBinary = {
	readonly cliPath: string;
	readonly cliVersion: string;
	readonly isRecent: boolean;
}

type RhinoInstance = {
	readonly pipeId: string;
	readonly processId: number;
	readonly processName: string;
	readonly processVersion: string;
	readonly processAge: number;
	readonly activeDoc: RhinoDocument;
	readonly activeViewport: string;
}

type RhinoDocument = {
	readonly title: string;
	readonly location: string;
}

// minimum rhinocode cli version
const RHC_MIN_VER = "0.2.0";
// default path of rhinocode cli binary
const {
	defaultName: RHC_DEFAULT_NAME,
	defaultFolder: RHC_DEFAULT_FOLDER,
	relativeBinPath: RHC_RELATIVE_BIN_PATH
} = (function () {
	switch (Os.platform()) {
		case 'darwin':
			console.info("rhinocode: using default paths for \"darwin\"")
			return {
				defaultName: "rhinocode.exe",
				defaultFolder: "/Applications/RhinoWIP.app",
				relativeBinPath: "Contents/Resources/bin/rhinocode"
			}
		case 'win32':
			console.info("rhinocode: using default paths for \"win32\"")
			return {
				defaultName: "RhinoCode.exe",
				defaultFolder: "C:\\Program Files\\Rhino 8 WIP\\System",
				relativeBinPath: "System\\RhinoCode.exe"
			}
		default:
			console.error("rhinocode: invalid platform:", Os.platform())
			return {
				defaultName: "",
				defaultFolder: "",
				relativeBinPath: ""
			}
	}
})()


// "Run in Rhino" command implementation
function runInRhinoCommand() {
	const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;

	const configs = vscode.workspace.getConfiguration('rhinocode');
	const showActiveDocument = configs.get<boolean>("showActiveDocument");
	const showActiveDocumentPath = configs.get<boolean>("showActiveDocumentPath");
	const showActiveViewport = configs.get<boolean>("showActiveViewport");
	const showProcessId = configs.get<boolean>("showProcessId");
	const showProcessAge = configs.get<boolean>("showProcessAge");
	const showProcessFullVersion = configs.get<boolean>("showProcessFullVersion");

	if (typeof activeFile !== "string" || activeFile.trim() == "") {
		vscode.window.showInformationMessage(
			"There are no active scripts open"
		);
		return;
	}

	const rhc = getRhinoCode();
	if (rhc == null) {
		vscode.window.showErrorMessage(
			"Could not find rhinocode. Make sure Rhino WIP is installed. " +
			"If so, set the 'rhinoInstallPath' setting"
		);
		return;
	}

	if (!rhc.isRecent) {
		vscode.window.showErrorMessage(
			`Incompatible rhinocode binary is found at ${rhc.cliPath}\n` +
			`Expected: ${RHC_MIN_VER} Found: ${rhc.cliVersion}`
		);
		return;
	}

	console.info(`rhinocode: using rhinocode (${rhc.cliVersion}) \"${rhc.cliPath}\"`);

	const rhcInstances = getRhinoInstances(rhc.cliPath);
	// rhcInstances will never be an array of length 0
	if (rhcInstances == null) {
		vscode.window.showErrorMessage(
			"There are no instance of Rhino WIP running"
		);
		return;
	}

	// automatically use the only available rhino instance and don't prompt user
	if (rhcInstances.length === 1) {
		runScript(rhc.cliPath, rhcInstances[0], activeFile);
		return;
	}

	// otherwise prep a list of rhino instances,
	const names = new Map(
		rhcInstances.map(r => {
			let title = r.processName;

			if (showProcessFullVersion)
				title += ` ${r.processVersion}`;
			else {
				const verisonNumbers = r.processVersion.split('.');
				title += ` ${verisonNumbers[0]}.${verisonNumbers[1]}`;
			}

			if (showProcessId)
				title += ` <${r.processId}>`;

			if (showActiveDocument)
				title += r.activeDoc.title
					? ` - "${r.activeDoc.title}"`
					: ' - "Untitled"';

			if (showActiveDocumentPath)
				title += r.activeDoc.title
					? ` - @ ${r.activeDoc.location}`
					: " - Not Saved";

			if (showActiveViewport)
				title += ` [${r.activeViewport}]`;

			if (showProcessAge) {
				if (r.processAge < 1)
					title += " (Started Just Now)";
				else {
					let age = Timespan.parse(`${r.processAge}m`);
					title += ` (${Timespan.getString(age, { abbv: false })})`;
				}
			}

			return [title, r] as [string, RhinoInstance]
		})
	);
	// and prompt user to select one
	vscode.window.showQuickPick([...names.keys()], { canPickMany: false })
		.then((v) => {
			if (v && names.has(v))
				// and run active script with the selected rhino
				runScript(rhc.cliPath, names.get(v)!, activeFile)
		});


	function runScript(rhcPath: string, rhino: RhinoInstance, scriptPath: string) {
		const scriptCmd = `"${rhcPath}" --rhino ${rhino?.pipeId} script \"${scriptPath}\"`;
		try {
			console.log(`rhinocode: running rhinocode script \"${scriptCmd}\"`)
			Cp.execSync(scriptCmd);
		} catch (error) {
			console.error(
				`rhinocode: unexpected rhinocode error: "${scriptCmd}"\n`
			);
		}
	}
}


// get information on running instances of rhino using given rhinocode binary
function getRhinoInstances(rhcPath: string): Array<RhinoInstance> | null {
	if (typeof rhcPath !== "string")
		return null;

	var rhinos: Array<RhinoInstance>

	const cmd = `"${rhcPath}" list --json`
	try {
		const stdout = Cp.execSync(cmd);
		rhinos = JSON.parse(stdout.toString());
	} catch (error) {
		console.error(
			`rhinocode: unexpected error: ${cmd}`
		);
		return null;
	}

	if (Array.isArray(rhinos) === false) {
		console.error(
			`rhinocode: unexpected array: "${cmd}" --version\n`,
			"receive: " + (typeof rhinos)
		);
		return null;
	}

	if (rhinos.length == 0)
		return null;

	// rhino instances can change between calls so it is better
	// to keep the rhino list ordered in the ui
	// keep the most recent one (larger pid) first
	return rhinos.sort((a, b) => a.processAge - b.processAge);
}


// ensure a valid rhincode binary path or null if no installation found
function getRhinoCode(): RhinoCodeBinary | null {
	const configs = vscode.workspace.getConfiguration('rhinocode');
	const rhinoPathConfig = configs.get<string>("rhinoInstallPath", "");

	const rhinoPaths = (rhinoPathConfig == "" ?
		RHC_DEFAULT_FOLDER : `${rhinoPathConfig};${RHC_DEFAULT_FOLDER}`)
		.split(';')
		.map(getRhinoCodePath)
		.filter(rhc => rhc != null) as string[];

	if (rhinoPaths.length == 0)
		return null;

	if (rhinoPaths.length > 1) {
		console.warn(
			"rhinocode: multiple valid rhinocode applications found"
		);
		rhinoPaths.forEach(path => console.warn(`rhinocode: ${path}`));
	}

	const rhcPath = rhinoPaths[0];
	// check rhinocode version
	try {
		const stdout = Cp.execSync(`"${rhcPath}" --version`);
		const cliVersion = stdout.toString().trimEnd();

		if (Ver.compare(cliVersion, RHC_MIN_VER, '>='))
			return { cliPath: rhcPath, cliVersion: cliVersion, isRecent: true };
		else {
			console.warn(
				`rhinocode: invalid rhinocode version '${cliVersion}' ` +
				`@ "${rhcPath}", ` +
				`expected '>= ${RHC_MIN_VER}'`
			);
			return { cliPath: rhcPath, cliVersion: cliVersion, isRecent: false };
		}
	}
	catch (error) {
		console.error(
			`rhinocode: unexpected rhinocode error: "${rhcPath}" --version`,
			error
		);
		return null;
	}
}


// find path of rhinocode binary in given directory, or null if not found
function getRhinoCodePath(rhcDirectory: string): string | null {

	// ignore all invalid paths in case the user shares the settings
	// between different platforms or has legacy paths
	if (typeof rhcDirectory != "string" || rhcDirectory.trim() == "") {
		console.warn(
			`rhinocode: ignored missing rhinocode directory "${rhcDirectory}"`
		);
		return null;
	}

	var rhcPath: string;
	rhcPath = Path.join(rhcDirectory, RHC_RELATIVE_BIN_PATH)
	if (rhinoCodePathExists(rhcPath))
		return rhcPath;

	rhcPath = Path.join(rhcDirectory, RHC_DEFAULT_NAME)
	if (rhinoCodePathExists(rhcPath))
		return rhcPath;

	console.warn(
		`rhinocode: ignored missing rhinocode binary in "${rhcDirectory}"`
	);
	return null;

	/** Like `fs.existsSync`, but impose an absolute path */
	function rhinoCodePathExists(path: string): boolean {
		if (Path.isAbsolute(path) === false)
			return false;

		try {
			return Fs.statSync(path) != undefined;
		} catch (error) {
			return false
		}
	}
}
