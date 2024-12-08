/**********************
  Sandbox Manager
**********************/

/** Class to manage iframe code sandbox */
class Sandbox {

  /** Contruct sandbox instance and check for ID conflicts */
  constructor (elementId) {
    if (document.getElementById(elementId)) {
      throw new Error(`Only one sandbox with id ${elementId} can exist at a time.`)
    }

    this.id = elementId
  }

  /** Run code in sandbox */
  async run (code, callback) {
    // Restart the sandbox
    this.stop()
    this.start(callback)

    // Wait for sandbox iframe to initialize
    setTimeout(() => {
      // Send code to sandbox iframe
      this.iframe.contentWindow.postMessage(code, '*')
    }, 200)
  }

  /** Add the iframe sandbox to the DOM, and assign a callback for recieved messages */
  start (callback) {
    if (this.iframe) {
      throw new Error('The sandbox is already started. It must be stopped before starting again.')
    }

    this.iframe = document.createElement('iframe')
    this.iframe.srcdoc = '<html><head><script src="sandbox.js"></script></head></html>'
    this.iframe.id = this.id
    this.iframe.sandbox = 'allow-scripts'
    document.body.appendChild(this.iframe)

    this.assignMessageHandler(callback)
  }

  /** Assign the provided callback to be triggered whenever a message is revieved from the sandbox */
  assignMessageHandler (callback) {
    // Listener function to recieve and verify messages from the sandbox
    this.messageHandler = (message) => {
      // Verify that the message is from the sandbox iframe
      if (message.origin === "null" && this.iframe && message.source === this.iframe.contentWindow) {
        // Trigger the callback with the message data
        callback(message.data)
      }
    }

    // Attach the provided message callback
    window.addEventListener('message', this.messageHandler)
  }

  /** Remove the iframe sandbox from the DOM */
  stop () {
    if (this.iframe) {
      window.removeEventListener('message', this.messageHandler)
      this.iframe.parentNode.removeChild(this.iframe)
      this.iframe = null
    }
  }
}

/**********************
  Editor View Controller
**********************/

/** Abstract Editor class */
class Editor {
  /** Empty Constructor. Properties are assigned in subclasses. */
  constructor () {
    this.dependencies = []
  }

  /** Download the editor dependencies */
  async loadDependencies () {
    for (let dependency of this.dependencies) {
      await this.importScript(dependency)
    }
  }

  /** Return a promise that will resolve once the provided script has been imported */
  importScript (url) {
    return new Promise((resolve, reject) => {
      // Add a script element to the DOM, to download the dependency library
      const script = document.createElement('script')
      script.src = url
      script.onload = function () {
        // Response the promise once the library is loaded
        resolve()
      }
      document.body.appendChild(script)
    })
  }

  /** Load the editor into the DOM.  See subclasses for implementation details */
  async loadEditor (elementId, initialValue) {
    if (!elementId) { throw new Error('Must provide element id for editor.') }
    this.elementId = elementId
    await this.loadDependencies()
  }

  /** Get the current contents of the editor.  See subclasses for implementation details */
  getValue () {
    if (!this.editor) { throw new Error('Must load editor before getting value.') }
  }

  /** Set an on-change listener for the editor contents. See subclasses for implementation details */
  setOnChangeListener (listener) {
    if (!this.editor) { throw new Error('Must load editor before setting change listener.') }
  }
}

/** Editor Subclass for Monaco Editor from VS Code */
class MonacoEditor extends Editor {
  constructor () {
    super()
    this.dependencies = [ 'https://cdn.patricktriest.com/vendor/monaco/vs/loader.js' ]
  }

  async loadEditor(elementId, initialValue) {
    await super.loadEditor(elementId, initialValue)
    this.editor = await new Promise((resolve, reject) => {
      // Importing Monaco is a bit complicated because it is very modular and uses lots of webworkers.
      // See https://github.com/Microsoft/monaco-editor for an explanation of what's going on here
      require.config({ paths: { 'vs': 'https://cdn.patricktriest.com/vendor/monaco/vs' }})
      window.MonacoEnvironment = {
        getWorkerUrl: function(workerId, label) {
          return 'monaco-editor-worker-loader-proxy.js';
        }
      }

      // "require" is from the Monaco "loader.js" script.
      // Using it here doesn't require any special build systems or bundling libraries.
      require(['vs/editor/editor.main'], () => {
        let editor = monaco.editor.create(document.getElementById('editor'), {
          value: initialValue,
          language: 'javascript',
          theme: 'vs-dark',
          fontSize: '14px',
          tabSize: 2,
        })

        resolve(editor)
      })
    })

    // Need to manually re-size editor when window dimens change
    window.addEventListener("resize", () => {
      this.debounce(() => this.editor.layout(), 50)
    })
  }

  /** Helper function to delay resize */
  debounce(func, wait) {
    clearTimeout(this.timeout);
    this.timeout = setTimeout(func, wait)
  }

  setOnChangeListener(listener) {
    super.setOnChangeListener(listener)
    this.editor.onDidChangeModelContent(listener)
  }

  getValue() {
    super.getValue()
    return this.editor.getValue()
  }
}

/** Editor Subclass for Ace editor from Cloud9 */
class AceEditor extends Editor {
  constructor () {
    super()
    this.dependencies = [
      'https://cdnjs.cloudflare.com/ajax/libs/ace/1.2.8/ace.js',
     // 'https://cdnjs.cloudflare.com/ajax/libs/ace/1.2.8/ext-language_tools.js'
    ]
  }

  async loadEditor(elementId, initialValue) {
    await super.loadEditor(elementId, initialValue)
    this.editor = ace.edit(elementId)
    this.editor.setOptions({
      fontSize: '14px',
      theme: 'ace/theme/tomorrow_night_eighties',
      mode: 'ace/mode/javascript',
      showPrintMargin: false,
      tabSize: 2,
      // enableBasicAutocompletion: true,
      // enableSnippets: true,
      // enableLiveAutocompletion: true,
    })

    this.editor.getSession().setValue(initialValue)
  }

  setOnChangeListener(listener) {
    super.setOnChangeListener(listener)
    this.editor.getSession().on('change', listener)
  }

  getValue() {
    super.getValue()
    return this.editor.getValue()
  }
}

/**********************
  Log List View Controller
**********************/

/** Helper class to manage the log list UI Component */
class LogList {
  /** Find the log list element by id */
  constructor (elementId) {
    this.id = elementId
    this.logList = document.getElementById(this.id)
  }

  /** Clear all child nodes of the log list */
  clearLogs(id) {
    while (this.logList.firstChild) {
      this.logList.removeChild(this.logList.firstChild)
    }
  }

  /** Add a log message to the DOM */
  addLog (log, logtype) {
    let html = `<div class="log-item">`

    if (logtype === 'error') {
      html += `<h3 class="log-label log-label-error">ERROR</h3>`
    } else {
      html += `<h3 class="log-label">LOG</h3>`
    }

    html += `<h3 class="log-timestamp">${log.timestamp} ms</h3>`

    html += `<div class="log-content">
      <pre class="log-message">${JSON.stringify(log.message, null, 2)}</pre>`

    if (log.body) {
      html += `<pre class="log-body">${JSON.stringify(log.body, null, 2)}</pre>`
    }

    html += `</div></div>`

    this.logList.innerHTML += html
  }
}

/**********************
  App Controller
**********************/


/** Register service worker if compatable with current browser */
if (navigator.serviceWorker) {
  navigator.serviceWorker.register('sw.js').catch(console.error);
}

// Show basic "hello world" code by default
const initialValue =
`/**
 *  Welcome to OpenJS Sandbox!
 *
 *  Try experimenting with some Javascript code bellow.
 *
 *  Your code will execute in a sandboxed iframe within the browser.
 *  Watch out for infinate loops, they'll freeze this tab.
 *
 *  Also, this is a progressive web app, so it works completely offline.
 *
 *  To contribute, report bugs, or request features, visit the
 *  Github repository - https://github.com/triestpa/OpenJS-Sandbox
 */

function hello () {
  console.log("Hello world!");
}

hello()`

// Store app-wide vars in a global 'app' object
const app = {
  editor: null,
  logList: new LogList('log-list'),
  sandbox: new Sandbox('sandbox')
}

/* Read the URL editor param and load the editor if specified **/
switch (getParameterByName('editor')) {
  case 'monaco':
    setupMonacoEditor()
    break
  case 'ace':
    setupAceEditor()
    break
}

/** Display the received log in the UI */
function handleLogMessage (log) {
  if (log.body) {
    let logBody = JSON.parse(log.body)
    app.logList.addLog(logBody, log.type)
  }
}

/** Setup Monaco Editor */
async function setupMonacoEditor () {
  app.editor = new MonacoEditor()
  await initializeEditor()
}

/** Setup ACE editor  */
async function setupAceEditor () {
  app.editor = new AceEditor()
  await initializeEditor()

}

/** Initialize the selected editor */
async function initializeEditor () {
  document.getElementById('code-panel').classList.add('select-editor-hidden');
  document.getElementById('loader').classList.toggle('hidden');
  await app.editor.loadEditor('editor', initialValue)
  document.getElementById('loader').classList.toggle('hidden');
  document.getElementById('editor').onkeydown = function(event) {
    if (event.key == 'Enter' && event.shiftKey) {
      // Run code on shift+enter
      runCode()
      return false;
    } else if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      // Save file on ctrl/cmd + s
      event.preventDefault();
      saveAsFile()
    }
  }
}

/** Toggle the console output panel */
function toggleOutputVisibility () {
  document.getElementById('code-playground').classList.toggle('output-hidden');
  window.dispatchEvent(new Event('resize'));
}

/** Save editor contents to local JS file */
function saveAsFile () {
  const text = app.editor.getValue()
  const blob = new Blob([text], {type: "text/javascript;charset=utf-8"});
  saveAs(blob, 'sandbox-code.js');
}

/** Run code from the current editor in the sandbox */
async function runCode () {
  app.logList.clearLogs()
  app.sandbox.run(app.editor.getValue(), (message) => handleLogMessage(message))

  // Show output
  document.getElementById('code-playground').classList.remove('output-hidden');
  window.dispatchEvent(new Event('resize'));
}

/** Stop the code by destroying the sandbox */
function stopCode () {
  app.sandbox.stop()
}

/** Get URL parameter. From https://stackoverflow.com/a/901144 */
function getParameterByName(name, url) {
    if (!url) url = window.location.href;
    name = name.replace(/[\[\]]/g, "\\$&");
    var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)"),
        results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, " "));
}


