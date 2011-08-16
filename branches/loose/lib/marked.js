/**
 * marked - A markdown parser
 * Copyright (c) 2011, Christopher Jeffrey. (MIT Licensed)
 */

;(function() {

/**
 * Block-Level Grammar
 */

var block = {
  newline: /^\n/,
  block: /^[ ]{4,}[^\n]*(?:\n[ ]{4,}[^\n]*)*/,
  heading: /^ *(#{1,6}) *([^\n#]*) *#*/,
  lheading: /^([^\n]+)\n *(=|-){3,}/,
  hr: /^( ?[\-*_]){3,}/,
  blockquote: /^ *>[^\n]*(?:\n *>[^\n]*)*/,
  list: /^(?:( *)(\*|\+|-|\d+\.)[^\n]+(?:\n(?:\1 )+[^\n]+)*(?:\n{1,2}|$)){2,}/g,
  html: /^<([^\/\s>]+)[^\n>]*>[^\n]*(?:\n[^\n]+)*\n?<\/\1>/,
  text: /^[^\n]+/
};

block.keys = [
  'newline', 
  'block', 
  'heading', 
  'lheading', 
  'hr', 
  'blockquote', 
  'list', 
  'html', 
  'text'
];

/**
 * Lexer
 */

block.lexer = function(str) {
  var tokens = []
    , links = {};

  // normalize whitespace
  str = str.replace(/\r\n/g, '\n')
           .replace(/\r/g, '\n')
           .replace(/\t/g, '    ');

  // experimental
  //str = str.replace(/(^|\n) +(\n|$)/g, '$1$2');

  // grab link definitons
  str = str.replace(
    /^ {0,3}\[([^\]]+)\]: *([^ ]+)(?: +"([^"]+)")?[ \t]*(?:\n|$)/gm, 
    function(_, id, href, title) {
      links[id] = {
        href: href,
        title: title
      };
      return '';
    }
  );

  tokens.links = links;

  return block.token(str, tokens, 0);
};

block.token = function(str, tokens, line) {
  var rules = block
    , keys = block.keys
    , len = keys.length
    , key
    , cap;

  var scan = function() {
    if (!str) return;
    for (var i = 0; i < len; i++) {
      key = keys[i];
      if (cap = rules[key].exec(str)) {
        str = str.substring(cap[0].length);
        return true;
      }
    }
  };

  while (scan()) {
    switch (key) {
      case 'newline':
        line++;
        break;
      case 'hr':
        tokens.push({
          type: 'hr', 
          line: line
        });
        break;
      case 'lheading':
        tokens.push({
          type: 'heading', 
          depth: cap[2] === '=' ? 1 : 2, 
          text: cap[1],
          line: line
        });
        break;
      case 'heading':
        tokens.push({
          type: 'heading', 
          depth: cap[1].length, 
          text: cap[2], 
          line: line
        });
        break;
      case 'block':
        cap = cap[0].replace(/^ {4}/gm, '');
        tokens.push({
          type: 'block', 
          text: cap, 
          line: line
        });
        break;
      case 'list':
        var loose = new RegExp(
          '\n *\n' 
          + cap[1] 
          + '(?:\\*|\\+|-|\\d+\\.)'
        ).test(cap[0]);
        tokens.push({
          type: 'list_start',
          ordered: isFinite(cap[2]), 
          line: line
        });
        // get each top-level 
        // item in the list
        cap = cap[0].match(
          /^( *)(\*|\+|-|\d+\.)[^\n]+(?:\n(?:\1 )+[^\n]+)*/gm
        ); 
        each(cap, function(item) {
          // remove the list items sigil 
          // so its seen as the next token
          item = item.replace(/^ *(\*|\+|-|\d+\.) */, '');
          // outdent whatever the 
          // list item contains, hacky
          var len = /\n( +)/.exec(item);
          if (len) {
            len = len[1].length;
            item = item.replace(
              new RegExp('^ {' + len + '}', 'gm'), 
              ''
            );
          }
          tokens.push({
            type: loose 
              ? 'loose_list_item_start'
              : 'list_item_start', 
            line: line
          });

          // recurse
          block.token(item, tokens, line);

          tokens.push({
            type: 'list_item_end', 
            line: line
          });
        });
        tokens.push({
          type: 'list_end', 
          line: line
        });
        break;
      case 'html':
      case 'text':
        tokens.push({
          type: key, 
          text: cap[0], 
          line: line
        });
        break;
      case 'blockquote':
        tokens.push({
          type: 'blockquote_start', 
          line: line
        });
        cap = cap[0].replace(/^ *>/gm, ''); 

        // recurse
        block.token(cap, tokens, line);

        tokens.push({
          type: 'blockquote_end', 
          line: line
        });
        break;
    }
  }

  return tokens;
};

/**
 * Inline Processing
 */

var inline = {
  escape: /^\\([\\`*{}\[\]()#+\-.!])/,
  autolink: /^<([^ >]+(:|@)[^ >]+)>/,
  tag: /^<[^\n>]+>/,
  link: /^!?\[([^\]]+)\]\(([^\)]+)\)/,
  reflink: /^!?\[([^\]]+)\]\[([^\]]+)\]/,
  strong: /^__([\s\S]+?)__|^\*\*([\s\S]+?)\*\*/,
  em: /^_([^_]+)_|^\*([^*]+)\*/,
  code: /^`([^`]+)`|^``([\s\S]+?)``/
};

inline.keys = [
  'escape',
  'autolink', 
  'tag', 
  'link', 
  'reflink', 
  'strong', 
  'em', 
  'code'
];

// hacky, but performant
inline.text = (function(rules) {
  var keys = rules.keys
    , i = 0
    , l = keys.length
    , body = [];

  for (; i < l; i++) {
    body.push(rules[keys[i]].source
      .replace(/(^|[^\[])\^/g, '$1'));
  }

  keys.push('text');

  return new RegExp(
    '^([\\s\\S]+?)(?='
    + body.join('|')
    + '|$)'
  );
})(inline);

/**
 * Inline Lexer
 */

inline.lexer = function(str) {
  var out = ''
    , links = tokens.links
    , link = {}
    , text
    , href;

  var rules = inline
    , keys = inline.keys
    , len = keys.length
    , key
    , cap;

  var scan = function() {
    if (!str) return;
    for (var i = 0; i < len; i++) {
      key = keys[i];
      if (cap = rules[key].exec(str)) {
        str = str.substring(cap[0].length);
        return true;
      }
    }
  };

  while (scan()) {
    switch (key) {
      case 'escape': 
        out += cap[1];
        break;
      case 'tag':
        out += cap[0];
        break;
      case 'link':
      case 'reflink':
        if (cap[0][0] !== '!') {
          if (key === 'reflink') {
            link = links[cap[2]];
          } else {
            link.href = cap[2];
            link.title = cap[3];
          }
          out += '<a href="' 
            + escape(link.href) 
            + '"' 
            + (link.title
            ? ' title="' 
            + escape(link.title)
            + '"' 
            : '') 
            + '>'
            + inline.lexer(cap[1])
            + '</a>';
        } else {
          if (key === 'reflink') {
            link = links[cap[2]];
          } else {
            text = cap[2].match(/^([^\s]+)\s*(.+)?/);
            link.href = text[1];
            link.title = text[2];
          }
          out += '<img src="' 
            + escape(link.href)
            + '" alt="' 
            + escape(cap[1])
            + '"' 
            + (link.title
            ? ' title="' 
            + escape(link.title)
            + '"' 
            : '') 
            + '>';
        }
        break;
      case 'autolink':
        if (cap[2] === '@') {
          text = mangle(cap[1]);
          href = mangle('mailto:') + text;
        } else {
          text = escape(cap[1]);
          href = text;
        }
        out += '<a href="' + href + '">'
          + text
          + '</a>';
        break;
      case 'strong':
        out += '<strong>' 
          + inline.lexer(cap[2] || cap[1]) 
          + '</strong>';
        break;
      case 'em':
        out += '<em>' 
          + inline.lexer(cap[2] || cap[1]) 
          + '</em>';
        break;
      case 'code':
        out += '<code>' 
          + escape(cap[2] || cap[1]) 
          + '</code>';
        break;
      case 'text':
        out += escape(cap[1]);
        break;
      default:
        break;
    }
  }

  return out;
};

/**
 * Parsing
 */

var tokens
  , token;

var next = function() {
  return token = tokens.pop();
};

var tok = function() {
  switch (token.type) {
    case 'hr': 
      return '<hr>';
    case 'heading': 
      return '<h' + token.depth + '>' 
        + inline.lexer(token.text)
        + '</h' + token.depth + '>';
    case 'block': 
      return '<pre><code>' 
        + escape(token.text)
        + '</code></pre>';
    case 'blockquote_start': 
      var body = [];
      while (next().type !== 'blockquote_end') {
        body.push(tok());
      }
      return '<blockquote>' 
        + body.join('') 
        + '</blockquote>';
    case 'list_start':
      var body = []
        , type = token.ordered ? 'ol' : 'ul';
      while (next().type !== 'list_end') {
        body.push(tok());
      }
      return '<' + type + '>' 
        + body.join('') 
        + '</' + type + '>';
    case 'list_item_start': 
      var body = [];
      while (next().type !== 'list_item_end') {
        // TODO incorporate paragraph 
        // list items here
        body.push(token.type === 'text' 
          ? inline.lexer(token.text)
          : tok());
      }
      return '<li>' 
        + body.join(' ') 
        + '</li>';
    case 'loose_list_item_start': 
      var body = [];
      while (next().type !== 'list_item_end') {
        body.push(tok());
      }
      return '<li>' 
        + body.join('\n') 
        + '</li>';
    case 'html':
      return inline.lexer(token.text);
    case 'text': 
      var body = []
        , last = token.line;
      while (token && token.type === 'text') {
        if (token.line > last) break;
        last = token.line + 1;
        body.push(token.text);
        next();
      }
      if (token) tokens.push(token);
      return '<p>' 
        + inline.lexer(body.join('\n'))
        + '</p>';
  }
};

var parse = function(src) {
  tokens = src.reverse();

  var out = [];
  while (next()) {
    out.push(tok());
  }

  tokens = null;
  token = null;

  return out.join('\n');
};

/**
 * Helpers
 */

var escape = function(html) {
  return html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

var mangle = function(str) {
  var out = ''
    , ch
    , i = 0
    , l = str.length;

  for (; i < l; i++) {
    ch = str.charCodeAt(i);
    if (Math.random() > 0.5) {
      ch = 'x' + ch.toString(16);
    }
    out += '&#' + ch + ';';
  }

  return out;
};

var each = function(obj, func) {
  var i = 0, l = obj.length;
  for (; i < l; i++) func(obj[i]);
};

/**
 * Expose
 */

var marked = function(str) {
  return parse(block.lexer(str));
};

marked.parser = parse;
marked.lexer = block.lexer;

if (typeof module !== 'undefined') {
  module.exports = marked;
} else {
  this.marked = marked;
}

}).call(this);
