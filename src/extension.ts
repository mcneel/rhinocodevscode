import * as Vsc  from 'vscode';

import * as Cp   from 'child_process';
import * as Os   from 'os';
import * as Path from 'path';
import * as Fs   from 'fs'
import * as Ver  from 'compare-versions';

const Timespan = require("timespan-parser");


// Public

/** this method is called when extension is activated */
export function activate (context: Vsc.ExtensionContext) {
	let disposable = Vsc.commands.registerCommand ('rhinocode.runInRhino', runInRhinoCommand);

	context.subscriptions.push (disposable);
}

/** this method is called when extension is deactivated */
export function deactivate () { }


// Private

const RHC_MIN_VER = "0.2.0";
const {
	defaultFolder  : RHC_DEFAULT_FOLDER,
	relativeBinPath: RHC_RELATIVE_BIN_PATH
} = (function () {
	switch (Os.platform ()) {
		case 'darwin':
			return {
				defaultFolder: "/Applications/RhinoWIP.app",
				relativeBinPath: "Contents/Resources/bin/rhinocode"
			}
		case 'win32':
			return {
				defaultFolder: "C:\\Program Files\\Rhino 8 WIP\\System",
				relativeBinPath: "RhinoCode.exe"
			}
		default:
			console.error ("[RhinoCode] Invalid platform:", Os.platform ())
			return {
				defaultFolder: "",
				relativeBinPath: ""
			}
	}
})()

interface RhinoInstance {
	readonly pipeId        : string;
	readonly processId     : number;
	readonly processName   : string;
	readonly processVersion: string;
	readonly processAge    : number;
	readonly activeDoc     : RhinoDocument;
	readonly activeViewport: string;
}

interface RhinoDocument {
	readonly title: string;
	readonly location: string;
}

function runInRhinoCommand ()
{
	const activeFile = Vsc.window.activeTextEditor?.document.uri.fsPath;

	const configs                = Vsc.workspace.getConfiguration ('rhinocode');
	const showActiveDocument     = configs.get<boolean> ("showActiveDocument");
	const showActiveDocumentPath = configs.get<boolean> ("showActiveDocumentPath");
	const showActiveViewport     = configs.get<boolean> ("showActiveViewport");
	const showProcessId          = configs.get<boolean> ("showProcessId");
	const showProcessAge         = configs.get<boolean> ("showProcessAge");
	const showProcessFullVersion = configs.get<boolean> ("showProcessFullVersion");

	if (typeof activeFile !== "string" || activeFile.trim () == "") {
		Vsc.window.showInformationMessage (
			"There are no active scripts open"
		);
		return;
	}

	const rhcPath = getRhinoCode ();
	if (rhcPath == null) return; // Messages are already sent.

	const rhcInstances = getRhinoInstances (rhcPath);
	if (rhcInstances == null) return; // Messages are already sent.

	if (rhcInstances.length === 1) 
	{
		runScript (rhcPath, rhcInstances[0], activeFile);
		return;
	}

	// getRhinoInstances never returns an array of length 0.

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
				let age = Timespan.parse(`${r.processAge}m`);
				title += ` (${Timespan.getString(age, { abbv: false })})`;
			}

			return [title, r] as [string, RhinoInstance]
		})
	);

	Vsc.window.showQuickPick ([...names.keys()], { canPickMany: false })
		.then ((v) => {
			if (v && names.has (v))
				runScript (rhcPath, names.get (v)!, activeFile)
		});

	
	function runScript (rhcPath: string, rhino: RhinoInstance, scriptPath: string)
	{
		const scriptCmd = `"${rhcPath}" --rhino ${rhino?.pipeId} script \"${scriptPath}\"`;
		try {
			console.log(scriptCmd)
			Cp.execSync(scriptCmd);
		} catch (error) {
			logUnexpectedError (
				`Unexpected error: "${scriptCmd}"\n`
			);
		}
	}
}

/** ensure a valid RhinoCode application path or null if no installation found */
function getRhinoCode (): string|null
{
	const configs = Vsc.workspace.getConfiguration('rhinocode');
	const rhinoPathConfig = configs.get<string>("rhinoInstallPath", "");

	const rhinoPaths
		= rhinoPathConfig == "" ? []
		: rhinoPathConfig
			.split (';')
			.map (getRhinoCodePath)
			.filter (p => p != null) as string[] // "filter" does not return the correct type.

	if (rhinoPaths.length == 0)
	{
		var rhcPath = getRhinoCodePath (RHC_DEFAULT_FOLDER);
		if (rhcPath == null) {
			Vsc.window.showErrorMessage (
				"Could not find rhinocode. Make sure Rhino WIP is installed. If so, set the 'rhinoInstallPath' setting."
			);
			return null;
		}

		return rhcPath;
	}
	
	if (rhinoPaths.length > 1)
	{
		console.warn (
			"Multiple valid RhinoCode applications found."
		);
	}

	return rhinoPaths[0];


	function getRhinoCodePath (rhcDirectory: string): string|null
	{
		const rhcPath = Path.join (rhcDirectory, RHC_RELATIVE_BIN_PATH)
	
		// Ignore all invalid paths in case the user shares the settings between different platforms.
	
		if (typeof rhcDirectory != "string" || rhcDirectory.trim () == "") {
			console.warn (
				`Ignored invalid rhinocode directory "${rhcDirectory}"`
			);
			return null;
		}
	
		if (rhinoCodePathExists (rhcPath) === false) {
			console.warn (
				`Ignored invalid rhinocode application "${rhcPath}"`
			);
			return null;
		}
	
		// Check version.
		
		try
		{
			const stdout = Cp.execSync (`"${rhcPath}" --version`);
			const cliVersion = stdout.toString ().trimEnd ();
	
			if (Ver.compare (cliVersion, RHC_MIN_VER, '>='))
				return rhcPath;
	
			// Else ignore invalid versions for the same reason.
	
			console.warn (
				`Ignored rhinocode version '${cliVersion}', (expected '>= ${RHC_MIN_VER}')`,
				`RhinoCode path: "${rhcPath}"`,
			);
		}
		catch (error)
		{
			logUnexpectedError (
				`Unexpected error: "${rhcPath}" --version`,
				error
			);
		}
		return null;
	}	

	/** Like `fs.existsSync`, but impose an absolute path */
	function rhinoCodePathExists (path: string)
	{
		if (Path.isAbsolute (path) === false) {
			Vsc.window.showErrorMessage (
				`Invalid RhinoCode directory: ${path}\n`,
				"You must define absolute paths."
			);
			return false;
		}

		try {
			return Fs.statSync (path) != undefined;
		} catch (error) {
			return false
		}
	}
}

function getRhinoInstances (rhcPath: string): Array<RhinoInstance>|null
{
	if (typeof rhcPath !== "string")
		return null;

	var rhinos: Array<RhinoInstance>
	
	const cmd = `"${rhcPath}" list --json`
	try {
		const stdout = Cp.execSync (cmd);
		rhinos = JSON.parse (stdout.toString ());
	} catch (error) {
		logUnexpectedError (
			`Unexpected error: ${cmd}`
		);
		return null;
	}

	if (Array.isArray (rhinos) === false) {
		logUnexpectedError (
			`Unexpected array: "${cmd}" --version\n`,
			"receive: " + (typeof rhinos)
		);
		return null;
	}

	if (rhinos.length == 0) {
		Vsc.window.showErrorMessage (
			"There are no instance of Rhino WIP running"
		);
		return null;
	}

	// The order can be reversed between 2 calls if an instance of Rhino is open or closed (between these 2 calls).
	return rhinos.sort ((a, b) => a.processId - b.processId);
}

function logUnexpectedError (...messages: any[])
{
	console.error (...messages);
	// Vsc.window.showErrorMessage (
	// 	"Unexpected error. Please inform the McNeel team: "+
	// 	"https://discourse.mcneel.com/t/rhino-8-feature-rhinocode-cpython-csharp/128353"
	// );
}
