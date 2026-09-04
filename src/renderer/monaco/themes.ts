/**
 * Editor themes.
 *
 * Colours are chosen for contrast against the surrounding chrome defined in
 * styles/global.css, and the token palette keeps comments clearly recessive
 * while keywords, strings and numbers stay distinguishable for the ~8% of
 * people with a colour-vision deficiency: hue is never the only difference,
 * weight and lightness carry the distinction too.
 */

import type { editor } from 'monaco-editor'

export const DARK_THEME: editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'dce1e8' },
    { token: 'comment', foreground: '6b7484', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'c98fdb' },
    { token: 'keyword.control', foreground: 'c98fdb' },
    { token: 'string', foreground: '8fd18a' },
    { token: 'string.escape', foreground: '5ec9d8' },
    { token: 'number', foreground: 'e2a86b' },
    { token: 'regexp', foreground: '5ec9d8' },
    { token: 'operator', foreground: 'a8b3c2' },
    { token: 'type', foreground: '5ec9d8' },
    { token: 'type.identifier', foreground: '5ec9d8' },
    { token: 'identifier', foreground: 'dce1e8' },
    { token: 'variable', foreground: 'dce1e8' },
    { token: 'variable.parameter', foreground: 'd9a45f' },
    { token: 'function', foreground: '6cb6ff' },
    { token: 'tag', foreground: 'e07b7b' },
    { token: 'attribute.name', foreground: 'd9a45f' },
    { token: 'attribute.value', foreground: '8fd18a' },
    { token: 'delimiter', foreground: '9aa4b2' },
    { token: 'namespace', foreground: '5ec9d8' },
    { token: 'annotation', foreground: 'e2b341' },
    { token: 'invalid', foreground: 'f0625d' }
  ],
  colors: {
    'editor.background': '#16181d',
    'editor.foreground': '#dce1e8',
    'editorLineNumber.foreground': '#4b5361',
    'editorLineNumber.activeForeground': '#9aa4b2',
    'editorCursor.foreground': '#4d9fff',
    'editor.selectionBackground': '#2b3a52',
    'editor.inactiveSelectionBackground': '#232a35',
    'editor.selectionHighlightBackground': '#26303f',
    'editor.wordHighlightBackground': '#2a3444',
    'editor.wordHighlightStrongBackground': '#31405480',
    'editor.lineHighlightBackground': '#1b1e24',
    'editor.lineHighlightBorder': '#00000000',
    'editorIndentGuide.background1': '#252a33',
    'editorIndentGuide.activeBackground1': '#3d4552',
    'editorBracketMatch.background': '#2d3a4d',
    'editorBracketMatch.border': '#4d9fff',
    'editorWidget.background': '#21252d',
    'editorWidget.border': '#2f353f',
    'editorSuggestWidget.background': '#21252d',
    'editorSuggestWidget.border': '#2f353f',
    'editorSuggestWidget.selectedBackground': '#2d333e',
    'editorHoverWidget.background': '#21252d',
    'editorHoverWidget.border': '#2f353f',
    'editorGutter.background': '#16181d',
    'editorGutter.addedBackground': '#4ec9a5',
    'editorGutter.modifiedBackground': '#e2b341',
    'editorGutter.deletedBackground': '#f0625d',
    'editorError.foreground': '#f0625d',
    'editorWarning.foreground': '#e2b341',
    'editorInfo.foreground': '#4d9fff',
    'editorOverviewRuler.border': '#00000000',
    'diffEditor.insertedTextBackground': '#4ec9a520',
    'diffEditor.removedTextBackground': '#f0625d20',
    'scrollbarSlider.background': '#3d455280',
    'scrollbarSlider.hoverBackground': '#4b5361a0',
    'scrollbarSlider.activeBackground': '#6b7484a0',
    'minimap.background': '#16181d'
  }
}

export const LIGHT_THEME: editor.IStandaloneThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: '', foreground: '1f2328' },
    { token: 'comment', foreground: '6b7280', fontStyle: 'italic' },
    { token: 'keyword', foreground: '8250df' },
    { token: 'keyword.control', foreground: '8250df' },
    { token: 'string', foreground: '0a6640' },
    { token: 'string.escape', foreground: '0d7490' },
    { token: 'number', foreground: 'b45309' },
    { token: 'regexp', foreground: '0d7490' },
    { token: 'operator', foreground: '4b5563' },
    { token: 'type', foreground: '0d7490' },
    { token: 'type.identifier', foreground: '0d7490' },
    { token: 'identifier', foreground: '1f2328' },
    { token: 'variable', foreground: '1f2328' },
    { token: 'variable.parameter', foreground: '92400e' },
    { token: 'function', foreground: '0a58ca' },
    { token: 'tag', foreground: 'b91c1c' },
    { token: 'attribute.name', foreground: '92400e' },
    { token: 'attribute.value', foreground: '0a6640' },
    { token: 'delimiter', foreground: '565d68' },
    { token: 'namespace', foreground: '0d7490' },
    { token: 'annotation', foreground: '9a6a00' },
    { token: 'invalid', foreground: 'c62d28' }
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#1f2328',
    'editorLineNumber.foreground': '#b9bec8',
    'editorLineNumber.activeForeground': '#565d68',
    'editorCursor.foreground': '#0a66d0',
    'editor.selectionBackground': '#cfe0f7',
    'editor.inactiveSelectionBackground': '#e6ecf5',
    'editor.lineHighlightBackground': '#f5f6f8',
    'editor.lineHighlightBorder': '#00000000',
    'editorIndentGuide.background1': '#e6e8ec',
    'editorIndentGuide.activeBackground1': '#b9bec8',
    'editorBracketMatch.background': '#cfe0f7',
    'editorBracketMatch.border': '#0a66d0',
    'editorWidget.background': '#ffffff',
    'editorWidget.border': '#d6d9e0',
    'editorSuggestWidget.selectedBackground': '#e8eaee',
    'editorGutter.addedBackground': '#1a7f5a',
    'editorGutter.modifiedBackground': '#9a6a00',
    'editorGutter.deletedBackground': '#c62d28',
    'editorError.foreground': '#c62d28',
    'editorWarning.foreground': '#9a6a00',
    'editorInfo.foreground': '#0a66d0'
  }
}
