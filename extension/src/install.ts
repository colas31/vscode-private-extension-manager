import * as vscode from 'vscode';
import * as nls from 'vscode-nls/node';

import { ExtensionInfoService } from './extensionInfo';
import { findPackage } from './findPackage';
import { Package } from './Package';
import { Registry } from './Registry';
import { RegistryProvider } from './RegistryProvider';
import { getConfig, sleep } from './util';

const localize = nls.loadMessageBundle();

const DEFAULT_AUTO_RELOAD = false;

/**
 * Installs the given extension package.
 * @returns the installed package.
 */
export async function installExtension(pkg: Package): Promise<Package>;
/**
 * Installs the extension with the given ID, searching one or more registries
 * @param registry The registry containing the extension package, or a registry provider to search
 * @param extensionId The ID of the extension to install.
 * @param version Version or dist-tag such as "1.0.0" to find a specific version of the extension.
 *              If omitted, returns the latest version for the user's selected release channel.
 * @returns the installed package.
 */
export async function installExtension(
    registry: Registry | RegistryProvider,
    extensionId: string,
    version?: string,
): Promise<Package>;
export async function installExtension(
    pkgOrRegistry: Package | Registry | RegistryProvider,
    extensionId?: string,
    version?: string,
): Promise<Package> {
    if (pkgOrRegistry instanceof Package) {
        await installExtensionByPackage(pkgOrRegistry);
        return pkgOrRegistry;
    } else {
        const registry = pkgOrRegistry;

        if (extensionId === undefined) {
            throw new TypeError('extensionId must be defined');
        }

        return await installExtensionById(registry, extensionId, version);
    }
}

/**
 * Uninstalls the given extension.
 * @param pkgOrExtId The package or extension ID of the extension to uninstall.
 * @returns the ID of the uninstalled extension.
 */
export async function uninstallExtension(pkgOrExtId: Package | string): Promise<string> {
    const extensionId = pkgOrExtId instanceof Package ? pkgOrExtId.extensionId : pkgOrExtId;
    await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', extensionId);

    return extensionId;
}

/**
 * Updates all the given extensions to their latest versions and prompts the
 * user to reload the window if necessary.
 * @param packages The packages to update.
 */
export async function updateExtensions(extensionInfo: ExtensionInfoService, packages: Package[]): Promise<void> {
    const increment = 100 / packages.length;

    await vscode.window.withProgress(
        {
            cancellable: true,
            location: vscode.ProgressLocation.Notification,
            title: localize('updating.extensions', 'Updating extensions...'),
        },
        async (progress, token) => {
            for (const pkg of packages) {
                if (token.isCancellationRequested) {
                    break;
                }

                await extensionInfo.waitForExtensionChange(installExtension(pkg));

                progress.report({ increment });
            }
        },
    );

    if (!packages.every((pkg) => extensionInfo.didExtensionUpdate(pkg))) {
        await showReloadPrompt(
            localize(
                'reload.to.complete.update.all',
                'to complete updating the extensions.',
            ),
        );
    }
}

/**
 * Displays a message with a button to reload vscode.
 * @param suffixMessage The reason to reload VSCode. The message will be displayed in a "popin".
 */
export async function showReloadPrompt(suffixMessage: string): Promise<void> {
    let reload: any;

    if (getAutoReload()) {
        const message = localize(
            'automatic.reload',
            'Visual Studio Code will restart in 3 secondes {0}.',
            suffixMessage,
        );
        vscode.window.showInformationMessage(message);
        await sleep(3000);
        reload = true;
    } else {
        const message = localize(
            'reload',
            'Please reload Visual Studio Code {0}.',
            suffixMessage,
        );
        reload = await vscode.window.showInformationMessage(message, localize('reload.now', 'Reload Now'));
    }
    if (reload) {
        vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
}

/**
 * Installs the given extension package.
 * @param pkg
 */
async function installExtensionByPackage(pkg: Package) {
    const { vsix } = await pkg.getContents();

    if (!vsix) {
        throw new Error(
            localize('extension.missing.vsix', 'Extension {0} does not contain a .vsix package.', pkg.toString()),
        );
    }

    await vscode.commands.executeCommand('workbench.extensions.installExtension', vsix);
}

/**
 * Installs the extension with the given ID, searching one or more registries
 * @param registry The registry containing the extension package, or a registry provider to search
 * @param extensionId The ID of the extension to install.
 * @param version Version or dist-tag such as "1.0.0" to find a specific version of the extension.
 *              If omitted, returns the latest version for the user's selected release channel.
 */
async function installExtensionById(registry: Registry | RegistryProvider, extensionId: string, version?: string) {
    const pkg = await findPackage(registry, extensionId, version);

    await installExtensionByPackage(pkg);

    return pkg;
}

function getAutoReload() {
    const config = getConfig();
    const autoUpdate = config.get<boolean>('autoReload', DEFAULT_AUTO_RELOAD);

    return autoUpdate;
}