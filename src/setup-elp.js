const core = require('@actions/core')
const exec = require('@actions/exec')
const toolCache = require('@actions/tool-cache')
const fs = require('node:fs/promises')
const path = require('path')

async function main() {
  prepareLocal()
  const elpVersion = getRequiredInput('elp-version')
  assertArchsPlatforms()
  await installElp(elpVersion)
}

main().catch((error) => {
  core.setFailed(error.message)
})

async function installElp(elpVersion) {
  // We to this because tool-cache only likes semver
  elpVersionForCache = semverFromELPVersion(elpVersion)

  const toolName = 'elp'
  let cachePath = toolCache.find(toolName, elpVersionForCache)

  if (cachePath === '') {
    core.debug(`ELP ${elpVersion} (cache version: '${elpVersionForCache}') is not cached as a tool`)
    const elpTarGzUrl = await elpTarGz(elpVersion)
    const file = await toolCache.downloadTool(elpTarGzUrl)
    const targetDir = await toolCache.extractTar(file)
    cachePath = await toolCache.cacheDir(targetDir, toolName, elpVersionForCache)
  } else {
    core.debug(`ELP ${elpVersion} (cache version: '${elpVersionForCache}') is cached as a tool`)
  }

  // We want a deterministic name per runner (helpful for self-hosted, for example)
  const runnerToolPath = path.join(process.env.RUNNER_TEMP, '.setup-elp', 'elp')
  await fs.cp(cachePath, runnerToolPath, { recursive: true })
  core.addPath(runnerToolPath)

  reportInstalledELPVersion()
}

function semverFromELPVersion(elpVersion) {
  let [major, minor, patch, build] = elpVersion.split(/[-_]/).slice(0, 4)
  return `${Number(major)}.${Number(minor)}.${Number(patch)}+${Number(build) || 1}`
}

async function reportInstalledELPVersion() {
  const cmd = 'elp'
  const args = ['version']
  const version = await exec_(cmd, args)
  core.debug(`ELP installed version is '${version}'`)
}

function assertArchsPlatforms() {
  const knownArchsPlatforms = ['arm64:darwin', 'x64:darwin', 'arm64:linux', 'x64:linux']
  const archPlatform = `${arch()}:${platform()}`

  if (!knownArchsPlatforms.includes(archPlatform)) {
    const knownPlatformsPr = knownArchsPlatforms.join("', '")
    throw new Error(
      `Unknown <arch>:<platform> '${archPlatform}'. Must be one of ['${knownPlatformsPr}']`,
    )
  }
  core.debug(`<arch>:<platform> is '${archPlatform}'`)
}

function getRequiredInput(name) {
  return getInput(name, true)
}

function getInput(name, required) {
  const input = core.getInput(name, { required: required })
  core.debug(`input ${name} (required: ${required}) is '${input}'`)
  return input
}

function arch() {
  return process.arch
}

function platform() {
  return process.platform
}

function archToELPArch() {
  const elpArchs = {
    arm64: 'aarch64',
    x64: 'x86_64',
  }
  const elpArch = elpArchs[arch()]
  core.debug(`ELP arch. is '${elpArch}'`)
  return elpArch
}

function platformToELPPlatform() {
  const elpPlatforms = {
    linux: 'linux',
    darwin: 'macos',
  }
  const elpPlatform = elpPlatforms[platform()]
  core.debug(`ELP platform is '${elpPlatform}'`)
  return elpPlatform
}

function elpPlatformSuffix() {
  const elpPlatformSuffixes = {
    linux: 'unknown-linux-gnu',
    darwin: 'apple-darwin',
  }
  const elpPlatformSuffix = elpPlatformSuffixes[platform()]
  core.debug(`ELP platform suffix is '${elpPlatformSuffix}'`)
  return elpPlatformSuffix
}

async function otpMajorMinor() {
  const cmd = 'erl'
  const args = [
    '-eval',
    `
    Root = code:root_dir(),
    OTPRelease = erlang:system_info(otp_release),
    OTPVersionFile = filename:join([Root, "releases", OTPRelease, "OTP_VERSION"]),
    {ok, Version} = file:read_file(OTPVersionFile),
    io:fwrite(Version),
    halt().
    `,
    '-noshell',
  ]
  let otpMajorMinor = await exec_(cmd, args)
  const [major, minor] = otpMajorMinor.split('.').slice(0, 2)
  otpMajorMinor = `${major}.${minor}`
  core.debug(`Erlang/OTP <major>.<minor> is '${otpMajorMinor}'`)
  return otpMajorMinor
}

async function elpTarGzFile() {
  const platform = platformToELPPlatform()
  const arch = archToELPArch()
  const suffix = elpPlatformSuffix()
  const otp = await otpMajorMinor()
  const elpTarGzFile = `elp-${platform}-${arch}-${suffix}-otp-${otp}.tar.gz`
  core.debug(`ELP .tar.gz is '${elpTarGzFile}'`)
  return elpTarGzFile
}

async function elpTarGz(elpVersion) {
  const elpTarGzFile0 = await elpTarGzFile()
  const repo = 'https://github.com/WhatsApp/erlang-language-platform'
  const elpTarGz = `${repo}/releases/download/${elpVersion}/${elpTarGzFile0}`
  core.debug(`ELP download URL is '${elpTarGz}'`)
  return elpTarGz
}

async function exec_(cmd, args) {
  let output = ''
  await exec.exec(cmd, args, {
    listeners: {
      stdout: (data) => {
        output += data.toString()
      },
    },
    silent: true,
  })
  return output.replace('\n', '')
}

function prepareLocal() {
  process.env.RUNNER_TOOL_CACHE = process.env.RUNNER_TOOL_CACHE || '/tmp'
  process.env.RUNNER_TEMP = process.env.RUNNER_TEMP || '/tmp'
}
