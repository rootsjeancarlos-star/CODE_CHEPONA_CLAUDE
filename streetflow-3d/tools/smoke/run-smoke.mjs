#!/usr/bin/env node
// STREETFLOW 3D — ejecuta tools/smoke/smoke-webgpu.html en Chromium headless (Playwright)
// con varias combinaciones de flags y guarda capturas + results.json en tools/smoke/out/.
//
// Uso (desde la raíz del proyecto):
//   node tools/smoke/run-smoke.mjs              # arranca Vite en :5199 y ejecuta la matriz completa
//   node tools/smoke/run-smoke.mjs --quick      # solo las combinaciones de navegador (sin matriz de post)
//   node tools/smoke/run-smoke.mjs --url http://127.0.0.1:5199   # usa un servidor Vite ya arrancado
//   node tools/smoke/run-smoke.mjs --only webgpu-min             # solo los casos cuyo nombre contenga el texto
//
// Requiere @playwright/test (devDependency) y navegadores en PLAYWRIGHT_BROWSERS_PATH (p.ej. /opt/pw-browsers).

import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname( fileURLToPath( import.meta.url ) );
const ROOT = path.resolve( HERE, '../..' );
const OUT = path.join( HERE, 'out' );
const PAGE = '/tools/smoke/smoke-webgpu.html';

const argv = process.argv.slice( 2 );
const argValue = ( name ) => { const i = argv.indexOf( name ); return i >= 0 ? argv[ i + 1 ] : null; };
const QUICK = argv.includes( '--quick' );
const ONLY = argValue( '--only' );
let baseUrl = argValue( '--url' );

// Chromium completo (modo "new headless"); por defecto Playwright usa chromium-headless-shell en headless.
const FULL_CHROME = process.env.SMOKE_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// ---------------------------------------------------------------------------
// Combinaciones de navegador
// ---------------------------------------------------------------------------

const WEBGPU_FLAGS_TASK = [ '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader' ];
const WEBGPU_FLAGS_MIN = [ '--enable-unsafe-webgpu' ];

const browsers = {
	'shell-default': { launch: {}, desc: 'headless (chromium-headless-shell) sin flags' },
	'shell-webgpu-flags': { launch: { args: WEBGPU_FLAGS_TASK }, desc: 'headless-shell + ' + WEBGPU_FLAGS_TASK.join( ' ' ) },
	'shell-webgpu-min': { launch: { args: WEBGPU_FLAGS_MIN }, desc: 'headless-shell + --enable-unsafe-webgpu' },
	'newheadless-default': { launch: { executablePath: FULL_CHROME }, desc: 'Chromium completo (new headless) sin flags' },
	'newheadless-webgpu-min': { launch: { executablePath: FULL_CHROME, args: WEBGPU_FLAGS_MIN }, desc: 'Chromium completo (new headless) + --enable-unsafe-webgpu' },
	'no-gpu': { launch: { args: [ '--disable-gpu', '--disable-software-rasterizer' ] }, desc: 'headless-shell + --disable-gpu --disable-software-rasterizer (sin WebGPU ni WebGL2)' }
};

// ---------------------------------------------------------------------------
// Casos
// ---------------------------------------------------------------------------

const cases = [
	{ name: 'a-shell-default', browser: 'shell-default', query: {} },
	{ name: 'b-shell-webgpu-flags', browser: 'shell-webgpu-flags', query: {} },
	{ name: 'b-shell-webgpu-min', browser: 'shell-webgpu-min', query: {} },
	{ name: 'b-shell-webgpu-min-forceWebGL', browser: 'shell-webgpu-min', query: { forceWebGL: 1 } },
	{ name: 'b-shell-webgpu-min-noShim', browser: 'shell-webgpu-min', query: { noSwizzleShim: 1, frames: 10 } },
	{ name: 'c-newheadless-default', browser: 'newheadless-default', query: {} },
	{ name: 'c-newheadless-webgpu-min', browser: 'newheadless-webgpu-min', query: {} },
	{ name: 'd-no-gpu', browser: 'no-gpu', query: {} }
];

if ( ! QUICK ) {

	const posts = [ 'none', 'bloom-fxaa', 'bloom-smaa', 'bloom-traa', 'ssao-bloom', 'gtao-traa-bloom' ];
	for ( const [ tag, forceWebGL ] of [ [ 'webgpu', 0 ], [ 'webgl2', 1 ] ] ) {

		for ( const post of posts ) cases.push( { name: `m-${ tag }-post-${ post }`, browser: 'shell-webgpu-min', query: { forceWebGL, post, frames: 40 } } );
		cases.push( { name: `m-${ tag }-csm`, browser: 'shell-webgpu-min', query: { forceWebGL, csm: 1, frames: 40 } } );
		cases.push( { name: `m-${ tag }-vsm`, browser: 'shell-webgpu-min', query: { forceWebGL, shadowType: 'vsm', frames: 40 } } );
		cases.push( { name: `m-${ tag }-msaa`, browser: 'shell-webgpu-min', query: { forceWebGL, aa: 1, frames: 40 } } );
		cases.push( { name: `m-${ tag }-agx`, browser: 'shell-webgpu-min', query: { forceWebGL, tonemap: 'agx', frames: 40 } } );
		cases.push( { name: `m-${ tag }-lose`, browser: 'shell-webgpu-min', query: { forceWebGL, lose: 1, frames: 20 } } );

	}

}

// ---------------------------------------------------------------------------
// Vite
// ---------------------------------------------------------------------------

async function startVite() {

	const { createServer } = await import( 'vite' );
	const server = await createServer( {
		root: ROOT,
		logLevel: 'warn',
		server: { port: 5199, strictPort: true, host: '127.0.0.1' },
		optimizeDeps: {
			// Pre-empaquetar desde el inicio evita recargas de página a mitad de prueba
			entries: [ 'tools/smoke/smoke-webgpu.html' ],
			include: [
				'three/webgpu', 'three/tsl',
				'three/addons/tsl/display/BloomNode.js', 'three/addons/tsl/display/FXAANode.js',
				'three/addons/tsl/display/SMAANode.js', 'three/addons/tsl/display/TRAANode.js',
				'three/addons/tsl/display/SSAONode.js', 'three/addons/tsl/display/GTAONode.js',
				'three/addons/objects/SkyMesh.js', 'three/addons/csm/CSMShadowNode.js',
				'three/addons/capabilities/WebGPU.js', 'three/addons/capabilities/WebGL.js'
			]
		}
	} );
	await server.listen();
	return server;

}

// ---------------------------------------------------------------------------
// Ejecución de un caso
// ---------------------------------------------------------------------------

async function runCase( c ) {

	const b = browsers[ c.browser ];
	const result = { name: c.name, browser: c.browser, browserDesc: b.desc, query: c.query };
	const t0 = Date.now();
	let browser;

	try {

		browser = await chromium.launch( { headless: true, ...b.launch } );
		result.browserVersion = browser.version();
		const page = await browser.newPage( { viewport: { width: 960, height: 540 } } );

		const consoleMsgs = [];
		page.on( 'console', ( m ) => consoleMsgs.push( { type: m.type(), text: m.text().slice( 0, 400 ) } ) );
		page.on( 'pageerror', ( e ) => consoleMsgs.push( { type: 'pageerror', text: String( e && e.stack || e ).slice( 0, 600 ) } ) );

		const qs = new URLSearchParams( c.query ).toString();
		await page.goto( baseUrl + PAGE + ( qs ? '?' + qs : '' ), { waitUntil: 'load' } );

		await page.waitForFunction( () => {

			const s = window.__SMOKE__;
			return s && [ 'ok', 'error', 'no-backend' ].includes( s.status );

		}, null, { timeout: 240000, polling: 250 } );

		const smoke = await page.evaluate( () => JSON.parse( JSON.stringify( window.__SMOKE__ ) ) );
		Object.assign( result, smoke );

		await mkdir( OUT, { recursive: true } );
		const shot = path.join( OUT, c.name + '.png' );
		await page.screenshot( { path: shot } );
		result.screenshot = path.relative( ROOT, shot );

		result.console = {
			errors: consoleMsgs.filter( ( m ) => m.type === 'error' || m.type === 'pageerror' ).map( ( m ) => m.text ),
			warnings: consoleMsgs.filter( ( m ) => m.type === 'warning' ).map( ( m ) => m.text )
		};

	} catch ( e ) {

		result.status = 'runner-error';
		result.runnerError = String( e && e.message || e ).split( '\n' )[ 0 ];

	} finally {

		if ( browser ) await browser.close();

	}

	result.wallMs = Date.now() - t0;
	return result;

}

function summaryLine( r ) {

	const t = r.timings || {};
	const med = ( s ) => ( s ? s.median : '-' );
	return [
		r.name.padEnd( 34 ),
		String( r.status ).padEnd( 11 ),
		String( r.backend || '-' ).padEnd( 7 ),
		`init ${ t.initMs ?? '-' }ms`.padEnd( 12 ),
		`1er ${ t.firstFrameCpuMs ?? '-' }ms`.padEnd( 11 ),
		`cpu ${ med( t.loopCpu ) }ms`.padEnd( 13 ),
		`raf ${ med( t.rafInterval ) }ms`.padEnd( 13 ),
		`sync ${ med( t.syncedFrame ) }ms`.padEnd( 14 ),
		`dc ${ r.info ? r.info.drawCalls : '-' }`.padEnd( 7 ),
		`err ${ ( r.console ? r.console.errors.length : 0 ) + ( r.errors ? r.errors.length : 0 ) }`
	].join( ' ' );

}

// ---------------------------------------------------------------------------

async function main() {

	let server = null;
	if ( ! baseUrl ) {

		server = await startVite();
		baseUrl = 'http://127.0.0.1:5199';

	}

	if ( ! existsSync( FULL_CHROME ) ) console.warn( 'Aviso: no existe ' + FULL_CHROME + ' (casos new headless fallarán). Define SMOKE_CHROME.' );

	const selected = cases.filter( ( c ) => ! ONLY || c.name.includes( ONLY ) );
	const results = [];
	const tAll = Date.now();

	try {

		// Calentamiento: la primera carga hace que Vite transforme/optimice módulos
		if ( server ) await runCase( { name: 'warmup', browser: 'shell-default', query: { frames: 5 } } );

		for ( const c of selected ) {

			const r = await runCase( c );
			results.push( r );
			console.log( summaryLine( r ) );

		}

	} finally {

		if ( server ) await server.close();

	}

	await mkdir( OUT, { recursive: true } );
	await writeFile( path.join( OUT, 'results.json' ), JSON.stringify( { date: new Date().toISOString(), totalMs: Date.now() - tAll, results }, null, 2 ) );
	console.log( `\n${ results.length } casos en ${ Math.round( ( Date.now() - tAll ) / 1000 ) } s. Resultados: ${ path.relative( ROOT, path.join( OUT, 'results.json' ) ) }` );

	const failed = results.filter( ( r ) => r.status !== 'ok' && ! ( r.name.includes( 'no-gpu' ) && r.status === 'no-backend' ) );
	if ( failed.length ) {

		console.log( 'Casos con fallo: ' + failed.map( ( r ) => `${ r.name } (${ r.status })` ).join( ', ' ) );
		process.exitCode = 1;

	}

}

main().catch( ( e ) => { console.error( e ); process.exit( 1 ); } );
