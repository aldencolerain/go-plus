'use babel'
/* eslint-env jasmine */

import path from 'path'
import {lifecycle} from './../spec-helpers'

describe('gocodeprovider', () => {
  let completionDelay = null
  let autocompleteplusMain = null
  let autocompleteManager = null
  let provider = null
  let editor = null
  let editorView = null
  let workspaceElement = null
  let suggestions = null
  let suggestionsPromise = null
  let callCounter = 0

  beforeEach(() => {
    runs(() => {
      lifecycle.setup()
    })

    waitsForPromise(() => {
      return atom.packages.activatePackage('autocomplete-plus').then((pack) => {
        autocompleteplusMain = pack.mainModule
      })
    })
    waitsFor(() => {
      return autocompleteplusMain.autocompleteManager && autocompleteplusMain.autocompleteManager.ready
    })

    waitsForPromise(() => {
      return lifecycle.activatePackage()
    })

    runs(() => {
      spyOn(lifecycle.mainModule, 'provideAutocomplete').andCallThrough()
    })

    runs(() => {
      workspaceElement = atom.views.getView(atom.workspace)
      jasmine.attachToDOM(workspaceElement)

      // autocomplete-plus
      autocompleteManager = autocompleteplusMain.autocompleteManager
      spyOn(autocompleteManager, 'displaySuggestions').andCallThrough()
      spyOn(autocompleteManager, 'showSuggestionList').andCallThrough()
      spyOn(autocompleteManager, 'hideSuggestionList').andCallThrough()
      atom.config.set('autocomplete-plus.enableAutoActivation', true)
      completionDelay = 100
      atom.config.set('autocomplete-plus.autoActivationDelay', completionDelay)
      completionDelay += 100 // Rendering delay

      // autocomplete-go
      atom.config.set('go-plus.autocomplete.snippetMode', 'nameAndType')
      provider = lifecycle.mainModule.provideAutocomplete()
      spyOn(provider, 'getSuggestions').andCallThrough()
      provider.onDidInsertSuggestion = jasmine.createSpy()
      provider.onDidGetSuggestions((p) => {
        suggestionsPromise = p
      })

      suggestions = null
      callCounter = 0
    })

    waitsFor(() => {
      return provider.ready()
    })
  })

  afterEach(() => {
    lifecycle.teardown()
  })

  function resetSuggestionsAndPromise () {
    suggestions = null
    suggestionsPromise = null
  }

  function waitForSuggestions () {
    const call = ++callCounter

    waitsFor(() => {
      return provider.getSuggestions.calls.length === call && suggestionsPromise !== null
    })

    waitsForPromise(() => {
      return suggestionsPromise.then((s) => {
        suggestions = s
        suggestionsPromise = null // reset it so that the next call `waitsFor` above waits
      })
    })
  }

  function expectAnySuggestions () {
    expect(suggestions).toBeTruthy()
    expect(suggestions.length).toBeGreaterThan(0)
  }

  function insertText (editor, text) {
    const last = text.slice(-1)
    const prefix = text.slice(0, -1)
    if (prefix) {
      editor.insertText(prefix)
    }
    // only the last character triggers `getSuggestions`
    editor.insertText(last)
    advanceClock(completionDelay)
  }

  function openFileAt (file, row, column) {
    waitsForPromise(() => {
      return atom.workspace.open(file).then((e) => {
        editor = e
        editorView = atom.views.getView(editor)
      })
    })

    runs(() => {
      expect(provider).toBeDefined()
      expect(provider.getSuggestions).not.toHaveBeenCalled()
      expect(editorView.querySelector('.autocomplete-plus')).not.toExist()
      editor.setCursorScreenPosition([row, column])
    })
  }

  describe('matchFunc', () => {
    let t = (context) => {
      let match = provider.matchFunc(context.input)
      expect(match).toBeTruthy()
      expect(match.length).toBe(3)
      expect(match[0]).toBe(context.input)
      expect(match[1]).toBe(context.args)
      expect(match[2]).toBe(context.returns)
    }

    it('identifies function arguments', () => {
      t({
        input: 'func(name string, flag bool) bool',
        args: 'name string, flag bool',
        returns: 'bool'
      })
      t({
        input: 'func(name string, flag bool) (bool)',
        args: 'name string, flag bool',
        returns: 'bool'
      })
      t({
        input: 'func(name string, f func(t *testing.T)) bool',
        args: 'name string, f func(t *testing.T)',
        returns: 'bool'
      })
      t({
        input: 'func(name string, f func(t *testing.T)) (bool)',
        args: 'name string, f func(t *testing.T)',
        returns: 'bool'
      })
      t({
        input: 'func(name string, f func(t *testing.T) int) (bool)',
        args: 'name string, f func(t *testing.T) int',
        returns: 'bool'
      })
      t({
        input: 'func(pattern string, handler func(http.ResponseWriter, *http.Request))',
        args: 'pattern string, handler func(http.ResponseWriter, *http.Request)',
        returns: undefined
      })
      t({
        input: 'func(n int) func(p *T)',
        args: 'n int',
        returns: 'func(p *T)'
      })
    })
  })

  describe('parseType', () => {
    let t = (context) => {
      let result = provider.parseType(context.input)
      expect(result).toBeTruthy()
      expect(result.isFunc).toBeTruthy()
      expect(result.args).toEqual(context.args)
      expect(result.returns).toEqual(context.returns)
    }

    it('parses the function into args and returns arrays', () => {
      t({
        input: 'func(name string, flag bool) bool',
        args: [{
          isFunc: false,
          name: 'name string',
          identifier: 'name',
          type: 'string'
        }, {
          isFunc: false,
          name: 'flag bool',
          identifier: 'flag',
          type: 'bool'
        }],
        returns: [{
          isFunc: false,
          name: 'bool',
          identifier: '',
          type: 'bool'
        }]
      })
      t({
        input: 'func(name string, flag bool) (bool)',
        args: [{
          isFunc: false,
          name: 'name string',
          identifier: 'name',
          type: 'string'
        }, {
          isFunc: false,
          name: 'flag bool',
          identifier: 'flag',
          type: 'bool'
        }],
        returns: [{
          isFunc: false,
          name: 'bool',
          identifier: '',
          type: 'bool'
        }]
      })
      t({
        input: 'func(name string, f func(t *testing.T)) bool',
        args: [{
          isFunc: false,
          name: 'name string',
          identifier: 'name',
          type: 'string'
        }, {
          isFunc: true,
          name: 'f func(t *testing.T)',
          identifier: 'f',
          type: {
            isFunc: true,
            name: 'func(t *testing.T)',
            args: [{
              isFunc: false,
              name: 't *testing.T',
              identifier: 't',
              type: '*testing.T'
            }],
            returns: []
          }
        }],
        returns: [{
          isFunc: false,
          name: 'bool',
          identifier: '',
          type: 'bool'
        }]
      })
      t({
        input: 'func(name string, f func(t *testing.T)) (bool)',
        args: [{
          isFunc: false,
          name: 'name string',
          identifier: 'name',
          type: 'string'
        }, {
          isFunc: true,
          name: 'f func(t *testing.T)',
          identifier: 'f',
          type: {
            isFunc: true,
            name: 'func(t *testing.T)',
            args: [{
              isFunc: false,
              name: 't *testing.T',
              identifier: 't',
              type: '*testing.T'
            }],
            returns: []
          }
        }],
        returns: [{
          isFunc: false,
          name: 'bool',
          identifier: '',
          type: 'bool'
        }]
      })
      t({
        input: 'func(pattern string, handler func(http.ResponseWriter, *http.Request))',
        args: [{
          isFunc: false,
          name: 'pattern string',
          identifier: 'pattern',
          type: 'string'
        }, {
          isFunc: true,
          name: 'handler func(http.ResponseWriter, *http.Request)',
          identifier: 'handler',
          type: {
            isFunc: true,
            name: 'func(http.ResponseWriter, *http.Request)',
            args: [{
              isFunc: false,
              name: 'http.ResponseWriter',
              identifier: '',
              type: 'http.ResponseWriter'
            }, {
              isFunc: false,
              name: '*http.Request',
              identifier: '',
              type: '*http.Request'
            }],
            returns: []
          }
        }],
        returns: []
      })
      t({
        input: 'func(pattern string, handler func(http.ResponseWriter, *http.Request), otherhandler func(http.ResponseWriter, *http.Request))',
        args: [{
          isFunc: false,
          name: 'pattern string',
          identifier: 'pattern',
          type: 'string'
        }, {
          isFunc: true,
          name: 'handler func(http.ResponseWriter, *http.Request)',
          identifier: 'handler',
          type: {
            isFunc: true,
            name: 'func(http.ResponseWriter, *http.Request)',
            args: [{
              isFunc: false,
              name: 'http.ResponseWriter',
              identifier: '',
              type: 'http.ResponseWriter'
            }, {
              isFunc: false,
              name: '*http.Request',
              identifier: '',
              type: '*http.Request'
            }],
            returns: []
          }
        }, {
          isFunc: true,
          name: 'otherhandler func(http.ResponseWriter, *http.Request)',
          identifier: 'otherhandler',
          type: {
            isFunc: true,
            name: 'func(http.ResponseWriter, *http.Request)',
            args: [{
              isFunc: false,
              name: 'http.ResponseWriter',
              identifier: '',
              type: 'http.ResponseWriter'
            }, {
              isFunc: false,
              name: '*http.Request',
              identifier: '',
              type: '*http.Request'
            }],
            returns: []
          }
        }],
        returns: []
      })
      t({
        input: 'func(pattern string, handler func(w http.ResponseWriter, r *http.Request), otherhandler func(w http.ResponseWriter, r *http.Request))',
        args: [{
          isFunc: false,
          name: 'pattern string',
          identifier: 'pattern',
          type: 'string'
        }, {
          isFunc: true,
          name: 'handler func(w http.ResponseWriter, r *http.Request)',
          identifier: 'handler',
          type: {
            isFunc: true,
            name: 'func(w http.ResponseWriter, r *http.Request)',
            args: [{
              isFunc: false,
              name: 'w http.ResponseWriter',
              identifier: 'w',
              type: 'http.ResponseWriter'
            }, {
              isFunc: false,
              name: 'r *http.Request',
              identifier: 'r',
              type: '*http.Request'
            }],
            returns: []
          }
        }, {
          isFunc: true,
          name: 'otherhandler func(w http.ResponseWriter, r *http.Request)',
          identifier: 'otherhandler',
          type: {
            isFunc: true,
            name: 'func(w http.ResponseWriter, r *http.Request)',
            args: [{
              isFunc: false,
              name: 'w http.ResponseWriter',
              identifier: 'w',
              type: 'http.ResponseWriter'
            }, {
              isFunc: false,
              name: 'r *http.Request',
              identifier: 'r',
              type: '*http.Request'
            }],
            returns: []
          }
        }],
        returns: []
      })
      t({
        input: 'func()',
        args: [],
        returns: []
      })
      t({
        input: 'func(x int) int',
        args: [{
          isFunc: false,
          name: 'x int',
          identifier: 'x',
          type: 'int'
        }],
        returns: [{
          isFunc: false,
          name: 'int',
          identifier: '',
          type: 'int'
        }]
      })
      t({
        input: 'func(a, _ int, z float32) bool',
        args: [{
          isFunc: false,
          name: 'a',
          identifier: '',
          type: 'a'
        }, {
          isFunc: false,
          name: '_ int',
          identifier: '_',
          type: 'int'
        }, {
          isFunc: false,
          name: 'z float32',
          identifier: 'z',
          type: 'float32'
        }],
        returns: [{
          isFunc: false,
          name: 'bool',
          identifier: '',
          type: 'bool'
        }]
      })
      t({
        input: 'func(a, b int, z float32) (bool)',
        args: [{
          isFunc: false,
          name: 'a',
          identifier: '',
          type: 'a'
        }, {
          isFunc: false,
          name: 'b int',
          identifier: 'b',
          type: 'int'
        }, {
          isFunc: false,
          name: 'z float32',
          identifier: 'z',
          type: 'float32'
        }],
        returns: [{
          isFunc: false,
          name: 'bool',
          identifier: '',
          type: 'bool'
        }]
      })
      t({
        input: 'func(a, b int, z float64, opt ...interface{}) (success bool)',
        args: [{
          isFunc: false,
          name: 'a',
          identifier: '',
          type: 'a'
        }, {
          isFunc: false,
          name: 'b int',
          identifier: 'b',
          type: 'int'
        }, {
          isFunc: false,
          name: 'z float64',
          identifier: 'z',
          type: 'float64'
        }, {
          isFunc: false,
          name: 'opt ...interface{}',
          identifier: 'opt',
          type: '...interface{}'
        }],
        returns: [{
          isFunc: false,
          name: 'success bool',
          identifier: 'success',
          type: 'bool'
        }]
      })
      t({
        input: 'func(prefix string, values ...int)',
        args: [{
          isFunc: false,
          name: 'prefix string',
          identifier: 'prefix',
          type: 'string'
        }, {
          isFunc: false,
          name: 'values ...int',
          identifier: 'values',
          type: '...int'
        }],
        returns: []
      })
      t({
        input: 'func(int, int, float64) (float64, *[]int)',
        args: [{
          isFunc: false,
          name: 'int',
          identifier: '',
          type: 'int'
        }, {
          isFunc: false,
          name: 'int',
          identifier: '',
          type: 'int'
        }, {
          isFunc: false,
          name: 'float64',
          identifier: '',
          type: 'float64'
        }],
        returns: [{
          isFunc: false,
          name: 'float64',
          identifier: '',
          type: 'float64'
        }, {
          isFunc: false,
          name: '*[]int',
          identifier: '',
          type: '*[]int'
        }]
      })
      t({
        input: 'func(n int) func(p *T)',
        args: [{
          isFunc: false,
          name: 'n int',
          identifier: 'n',
          type: 'int'
        }],
        returns: [{
          isFunc: true,
          name: 'func(p *T)',
          identifier: '',
          type: {
            isFunc: true,
            name: 'func(p *T)',
            args: [{
              isFunc: false,
              name: 'p *T',
              identifier: 'p',
              type: '*T'
            }],
            returns: []
          }
        }]
      })
    })
  })

  describe('generateSnippet', () => {
    const t = (context) => {
      const result = provider.generateSnippet(context.input.name, context.input.type)
      expect(result).toBeTruthy()
      expect(result.displayText).toEqual(context.result.displayText)
      expect(result.snippet).toEqual(context.result.snippet)
    }

    it('parses the function into args and returns arrays', () => {
      t({
        input: {
          name: 'Print',
          type: {
            isFunc: true,
            name: 'func()',
            args: [],
            returns: []
          }
        },
        result: {
          snippet: 'Print()$0',
          displayText: 'Print()'
        }
      })
      t({
        input: {
          name: 'Print',
          type: {
            isFunc: true,
            name: 'func(x int) int',
            args: [{
              isFunc: false,
              name: 'x int',
              identifier: 'x',
              type: 'int'
            }],
            returns: [{
              isFunc: false,
              name: 'int',
              identifier: '',
              type: 'int'
            }]
          }
        },
        result: {
          snippet: 'Print(${1:x int})$0', // eslint-disable-line no-template-curly-in-string
          displayText: 'Print(x int)'
        }
      })
      t({
        input: {
          name: 'ServeFunc',
          type: {
            isFunc: true,
            name: 'func(pattern string, func(w http.ResponseWriter, r *http.Request))',
            args: [{
              isFunc: false,
              name: 'pattern string',
              identifier: 'pattern',
              type: 'string'
            }, {
              isFunc: true,
              name: 'func(w http.ResponseWriter, r *http.Request)',
              identifier: '',
              type: {
                isFunc: true,
                name: 'func(w http.ResponseWriter, r *http.Request)',
                args: [{
                  isFunc: false,
                  name: 'w http.ResponseWriter',
                  identifier: 'w',
                  type: 'http.ResponseWriter'
                }, {
                  isFunc: false,
                  name: 'r *http.Request',
                  identifier: 'r',
                  type: '*http.Request'
                }],
                returns: []
              }
            }],
            returns: []
          }
        },
        result: {
          snippet: 'ServeFunc(${1:pattern string}, ${2:func(${3:w} http.ResponseWriter, ${4:r} *http.Request) {\n\t$5\n\\}})$0', // eslint-disable-line no-template-curly-in-string
          displayText: 'ServeFunc(pattern string, func(w http.ResponseWriter, r *http.Request))'
        }
      })
      t({
        input: {
          name: 'It',
          type: {
            isFunc: true,
            name: 'func(text string, body interface{}, timeout ...float64) bool',
            args: [
              {
                isFunc: false,
                name: 'text string',
                identifier: 'text',
                type: 'string'
              },
              {
                isFunc: false,
                name: 'body interface{}',
                identifier: 'body',
                type: 'interface{}'
              },
              {
                isFunc: false,
                name: 'timeout ...float64',
                identifier: 'timeout',
                type: '...float64'
              }
            ],
            returns: [
              {
                isFunc: false,
                name: 'bool',
                identifier: '',
                type: 'bool'
              }
            ]
          }
        },
        result: {
          // snippet: 'It(${1:text string}, ${2:body interface{\\}}, ${3:timeout ...float64})$0',
          snippet: 'It(${1:text string}, ${2:body interface{\\}})$0', // eslint-disable-line no-template-curly-in-string
          displayText: 'It(text string, body interface{}, timeout ...float64)'
        }
      })
      t({
        input: {
          name: 'Bleh',
          type: {
            isFunc: true,
            name: 'func(f func() int)',
            args: [{
              isFunc: true,
              name: 'f func() int',
              identifier: 'f',
              type: {
                isFunc: true,
                name: 'func() int',
                args: [],
                returns: [{
                  isFunc: false,
                  name: 'int',
                  identifier: '',
                  type: 'int'
                }]
              }
            }],
            returns: []
          }
        },
        result: {
          snippet: 'Bleh(${1:func() int {\n\t$2\n\\}})$0', // eslint-disable-line no-template-curly-in-string
          displayText: 'Bleh(func() int)'
        }
      })
      /*
      func(x int) int
      func(a, _ int, z float32) bool
      func(a, b int, z float32) (bool)
      func(prefix string, values ...int)
      func(a, b int, z float64, opt ...interface{}) (success bool)
      func(int, int, float64) (float64, *[]int)
      func(n int) func(p *T)
      */
    })
  })

  describe('upgradeSuggestion', () => {
    it('parses params', () => {
      let result = provider.ensureNextArg(['f func() int'])
      expect(result).toEqual(['f func() int'])
      result = provider.ensureNextArg(['f func() int, s string'])
      expect(result).toEqual(['f func() int', 's string'])
      result = provider.ensureNextArg(['f func(s1 string, i1 int) int, s string'])
      expect(result).toEqual(['f func(s1 string, i1 int) int', 's string'])
    })
    it('generates snippets', () => {
      let result = provider.upgradeSuggestion({}, {
        name: 'Abc',
        type: 'func(f func() int)'
      })
      expect(result.displayText).toBe('Abc(func() int)')
      expect(result.snippet).toBe('Abc(${1:func() int {\n\t$2\n\\}})$0') // eslint-disable-line no-template-curly-in-string
      result = provider.upgradeSuggestion({}, {
        name: 'Abc',
        type: 'func(f func() interface{})'
      })
      expect(result.displayText).toBe('Abc(func() interface{})')
      expect(result.snippet).toBe('Abc(${1:func() interface{\\} {\n\t$2\n\\}})$0') // eslint-disable-line no-template-curly-in-string
      result = provider.upgradeSuggestion({}, {
        name: 'Abc',
        type: 'func(f func() (interface{}, interface{}))'
      })
      expect(result.displayText).toBe('Abc(func() (interface{}, interface{}))')
      expect(result.snippet).toBe('Abc(${1:func() (interface{\\}, interface{\\}) {\n\t$2\n\\}})$0') // eslint-disable-line no-template-curly-in-string
      result = provider.upgradeSuggestion({}, {
        name: 'Abc',
        type: 'func(f interface{})'
      })
      expect(result.displayText).toBe('Abc(f interface{})')
      expect(result.snippet).toBe('Abc(${1:f interface{\\}})$0') // eslint-disable-line no-template-curly-in-string
    })
  })

  describe('different snippetMode settings result in different suggestions', () => {
    const file = path.join('basic', 'main.go')

    describe('when snippetMode is nameAndType', () => {
      beforeEach(() => {
        atom.config.set('go-plus.autocomplete.snippetMode', 'nameAndType')
      })

      it('generates snippets with name and type argument placeholders', () => {
        openFileAt(file, 5, 6)

        runs(() => {
          insertText(editor, 'P')
        })

        waitForSuggestions()

        runs(() => {
          expectAnySuggestions()

          expect(suggestions[0]).toBeTruthy()
          expect(suggestions[0].displayText).toBe('Print(a ...interface{})')
          expect(suggestions[0].snippet).toBe('Print()$0')
          expect(suggestions[0].replacementPrefix).toBe('P')
          expect(suggestions[0].type).toBe('function')
          expect(suggestions[0].leftLabel).toBe('(n int, err error)')
          editor.backspace()
        })
      })
    })

    describe('when snippetMode is name', () => {
      beforeEach(() => {
        atom.config.set('go-plus.autocomplete.snippetMode', 'name')
      })

      it('generates snippets with name argument placeholders', () => {
        openFileAt(file, 5, 6)

        runs(() => {
          insertText(editor, 'P')
        })

        waitForSuggestions()

        runs(() => {
          expectAnySuggestions()

          expect(suggestions[0]).toBeTruthy()
          expect(suggestions[0].displayText).toBe('Print(a ...interface{})')
          expect(suggestions[0].snippet).toBe('Print()$0')
          expect(suggestions[0].replacementPrefix).toBe('P')
          expect(suggestions[0].type).toBe('function')
          expect(suggestions[0].leftLabel).toBe('(n int, err error)')
          editor.backspace()
        })
      })
    })

    describe('when snippetMode is none', () => {
      beforeEach(() => {
        atom.config.set('go-plus.autocomplete.snippetMode', 'none')
      })

      it('generates snippets with no args', () => {
        openFileAt(file, 5, 6)

        runs(() => {
          insertText(editor, 'P')
        })

        waitForSuggestions()

        runs(() => {
          expectAnySuggestions()

          expect(suggestions[0]).toBeTruthy()
          expect(suggestions[0].displayText).toBe('Print(a ...interface{})')
          expect(suggestions[0].snippet).toBe('Print($1)$0')
          expect(suggestions[0].replacementPrefix).toBe('P')
          expect(suggestions[0].type).toBe('function')
          expect(suggestions[0].leftLabel).toBe('(n int, err error)')
          editor.backspace()
        })
      })
    })
  })

  describe('scenarios', () => {
    describe('provides suggestions for unimported packages', () => {
      beforeEach(() => {
        atom.config.set('go-plus.autocomplete.snippetMode', 'nameAndType')
      })

      it('provides the exported types of the unimported package', () => {
        waitsFor(() => provider.allPkgs.size > 0)

        openFileAt(path.join('basic', 'main.go'), 7, 0)

        runs(() => {
          // get suggestions for package 'github.com/sqs/goreturns/returns'
          insertText(editor, 'returns.')
        })

        waitForSuggestions()

        runs(() => {
          expectAnySuggestions()

          expect(suggestions[0]).toBeTruthy()
          expect(suggestions[0].displayText).toBe('Process(pkgDir string, filename string, src []byte, opt *returns.Options)')
        })
      })
    })

    it('does not continue with suggestions from fmt after fmt.Printf(', () => {
      openFileAt(path.join('autocomplete', 'fmt-with-variable', 'main.go'), 7, 0)

      // add "fmt."
      runs(() => {
        insertText(editor, 'fmt.')
      })

      waitForSuggestions()

      // this results in several suggestions like Printf, Errorf
      runs(expectAnySuggestions)

      // complete the text by adding "Printf("
      runs(() => {
        insertText(editor, 'Printf(')
      })

      waitForSuggestions()

      runs(resetSuggestionsAndPromise)

      // get new suggestions for "f"
      runs(() => {
        insertText(editor, 'f')
      })

      waitForSuggestions()

      // should return a suggestion for "foo"
      runs(() => {
        expectAnySuggestions()
        expect(suggestions.find((s) => s.text === 'foo')).toBeTruthy()
      })
    })
  })

  describe('when the go-plus-issue-307 file is opened', () => {
    const file = path.join('go-plus-issue-307', 'main.go')

    it('returns suggestions to autocomplete-plus scenario 1', () => {
      openFileAt(file, 13, 0)

      runs(() => {
        insertText(editor, '\tSayHello("world").')
      })

      waitForSuggestions()

      runs(() => {
        expectAnySuggestions()

        expect(suggestions[0]).toBeTruthy()
        expect(suggestions[0].displayText).toBe('Fatal(v ...interface{})')
        expect(suggestions[0].snippet).toBe('Fatal()$0')
        expect(suggestions[0].replacementPrefix).toBe('')
        expect(suggestions[0].type).toBe('function')
        expect(suggestions[0].leftLabel).toBe('')
        editor.backspace()
      })
    })

    it('returns suggestions to autocomplete-plus scenario 2', () => {
      openFileAt(file, 13, 0)

      runs(() => {
        insertText(editor, '\tSayHello("world") .')
      })

      waitForSuggestions()

      runs(() => {
        expectAnySuggestions()

        expect(suggestions[0]).toBeTruthy()
        expect(suggestions[0].displayText).toBe('Fatal(v ...interface{})')
        expect(suggestions[0].snippet).toBe('Fatal()$0')
        expect(suggestions[0].replacementPrefix).toBe('')
        expect(suggestions[0].type).toBe('function')
        expect(suggestions[0].leftLabel).toBe('')
        editor.backspace()
      })
    })

    it('returns suggestions to autocomplete-plus scenario 3', () => {
      openFileAt(file, 13, 0)

      runs(() => {
        insertText(editor, '\tSayHello("world")  .')
      })

      waitForSuggestions()

      runs(() => {
        expectAnySuggestions()

        expect(suggestions[0]).toBeTruthy()
        expect(suggestions[0].displayText).toBe('Fatal(v ...interface{})')
        expect(suggestions[0].snippet).toBe('Fatal()$0')
        expect(suggestions[0].replacementPrefix).toBe('')
        expect(suggestions[0].type).toBe('function')
        expect(suggestions[0].leftLabel).toBe('')
        editor.backspace()
      })
    })

    // TODO: Atom's prefix regex of: /(\b|['"~`!@#$%^&*(){}[\]=+,/?>])((\w+[\w-]*)|([.:;[{(< ]+))$/
    // returns an empty prefix when a '.' character is preceded by a \t
    xit('returns suggestions to autocomplete-plus scenario 4', () => {
      openFileAt(file, 13, 0)

      runs(() => {
        insertText(editor, '\tSayHello("world")\t.')
      })

      waitForSuggestions()

      runs(() => {
        expectAnySuggestions()

        expect(suggestions[0]).toBeTruthy()
        expect(suggestions[0].displayText).toBe('Fatal(v ...interface{})')
        expect(suggestions[0].snippet).toBe('Fatal()$0')
        expect(suggestions[0].replacementPrefix).toBe('')
        expect(suggestions[0].type).toBe('function')
        expect(suggestions[0].leftLabel).toBe('')
        editor.backspace()
      })
    })
  })
})
