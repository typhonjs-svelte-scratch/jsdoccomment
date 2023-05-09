'use strict';

var jsdocTypePrattParser = require('jsdoc-type-pratt-parser');
var esquery = require('esquery');
var commentParser = require('comment-parser');

/**
 * Removes initial and ending brackets from `rawType`
 * @param {JsdocTypeLine[]|JsdocTag} container
 * @param {boolean} isArr
 * @returns {void}
 */
const stripEncapsulatingBrackets = (container, isArr) => {
  if (isArr) {
    const firstItem = /** @type {JsdocTypeLine[]} */container[0];
    firstItem.rawType = firstItem.rawType.replace(/^\{/u, '');
    const lastItem = /** @type {JsdocTypeLine[]} */container.at(-1);
    lastItem.rawType = lastItem.rawType.replace(/\}$/u, '');
    return;
  }
  /** @type {JsdocTag} */
  container.rawType = /** @type {JsdocTag} */container.rawType.replace(/^\{/u, '').replace(/\}$/u, '');
};

/**
 * @typedef {{
 *   delimiter: string,
 *   postDelimiter: string,
 *   rawType: string,
 *   initial: string,
 *   type: "JsdocTypeLine"
 * }} JsdocTypeLine
 */

/**
 * @typedef {{
 *   delimiter: string,
 *   description: string,
 *   postDelimiter: string,
 *   initial: string,
 *   type: "JsdocDescriptionLine"
 * }} JsdocDescriptionLine
 */

/**
 * @typedef {{
 *   format: 'pipe' | 'plain' | 'prefix' | 'space',
 *   namepathOrURL: string,
 *   tag: string,
 *   text: string,
 *   type: "JsdocInlineTag"
 * }} JsdocInlineTag
 */

/**
 * @typedef {{
 *   delimiter: string,
 *   description: string,
 *   descriptionLines: JsdocDescriptionLine[],
 *   initial: string,
 *   inlineTags: JsdocInlineTag[]
 *   name: string,
 *   postDelimiter: string,
 *   postName: string,
 *   postTag: string,
 *   postType: string,
 *   rawType: string,
 *   tag: string,
 *   terminal: string,
 *   type: "JsdocTag",
 *   typeLines: JsdocTypeLine[],
 * }} JsdocTag
 */

/**
 * @typedef {number} Integer
 */

/**
 * @typedef {{
 *   delimiter: string,
 *   description: string,
 *   descriptionLines: JsdocDescriptionLine[],
 *   initial: string,
 *   inlineTags: JsdocInlineTag[]
 *   lastDescriptionLine: Integer,
 *   endLine: Integer,
 *   lineEnd: string,
 *   postDelimiter: string,
 *   tags: JsdocTag[],
 *   terminal: string,
 *   type: "JsdocBlock",
 * }} JsdocBlock
 */

/**
 * @param {object} cfg
 * @param {string} cfg.text
 * @param {string} cfg.tag
 * @param {'pipe' | 'plain' | 'prefix' | 'space'} cfg.format
 * @param {string} cfg.namepathOrURL
 * @returns {JsdocInlineTag}
 */
const inlineTagToAST = ({
  text,
  tag,
  format,
  namepathOrURL
}) => ({
  text,
  tag,
  format,
  namepathOrURL,
  type: 'JsdocInlineTag'
});

/**
 * Converts comment parser AST to ESTree format.
 * @param {import('comment-parser').Block} jsdoc
 * @param {import('jsdoc-type-pratt-parser').ParseMode} mode
 * @param {object} opts
 * @param {boolean} [opts.throwOnTypeParsingErrors=false]
 * @returns {JsdocBlock}
 */
const commentParserToESTree = (jsdoc, mode, {
  throwOnTypeParsingErrors = false
} = {}) => {
  /**
   * Strips brackets from a tag's `rawType` values and adds `parsedType`
   * @param {JsdocTag} lastTag
   * @returns {void}
   */
  const cleanUpLastTag = lastTag => {
    // Strip out `}` that encapsulates and is not part of
    //   the type
    stripEncapsulatingBrackets(lastTag);
    if (lastTag.typeLines.length) {
      stripEncapsulatingBrackets(lastTag.typeLines, true);
    }

    // With even a multiline type now in full, add parsing
    let parsedType = null;
    try {
      parsedType = jsdocTypePrattParser.parse(lastTag.rawType, mode);
    } catch (err) {
      // Ignore
      if (lastTag.rawType && throwOnTypeParsingErrors) {
        err.message = `Tag @${lastTag.tag} with raw type ` + `\`${lastTag.rawType}\` had parsing error: ${err.message}`;
        throw err;
      }
    }
    lastTag.parsedType = parsedType;
  };
  const {
    source,
    inlineTags: blockInlineTags
  } = jsdoc;
  const {
    tokens: {
      delimiter: delimiterRoot,
      lineEnd: lineEndRoot,
      postDelimiter: postDelimiterRoot,
      start: startRoot,
      end: endRoot
    }
  } = source[0];
  const endLine = source.length - 1;
  const ast = {
    delimiter: delimiterRoot,
    description: '',
    descriptionLines: [],
    inlineTags: blockInlineTags.map(t => inlineTagToAST(t)),
    initial: startRoot,
    // `terminal` will be overwritten if there are other entries
    terminal: endRoot,
    hasPreterminalDescription: 0,
    endLine,
    postDelimiter: postDelimiterRoot,
    lineEnd: lineEndRoot,
    type: 'JsdocBlock'
  };
  const tags = [];
  let lastDescriptionLine;
  let lastTag = null;
  let descLineStateOpen = true;
  source.forEach((info, idx) => {
    const {
      tokens
    } = info;
    const {
      delimiter,
      description,
      postDelimiter,
      start: initial,
      tag,
      end,
      type: rawType
    } = tokens;
    if (!tag && description && descLineStateOpen) {
      if (ast.descriptionStartLine === undefined) {
        ast.descriptionStartLine = idx;
      }
      ast.descriptionEndLine = idx;
    }
    if (tag || end) {
      descLineStateOpen = false;
      if (lastDescriptionLine === undefined) {
        lastDescriptionLine = idx;
      }

      // Clean-up with last tag before end or new tag
      if (lastTag) {
        cleanUpLastTag(lastTag);
      }

      // Stop the iteration when we reach the end
      // but only when there is no tag earlier in the line
      // to still process
      if (end && !tag) {
        ast.terminal = end;
        if (description) {
          if (lastTag) {
            ast.hasPreterminalTagDescription = 1;
          } else {
            ast.hasPreterminalDescription = 1;
          }
          const holder = lastTag || ast;
          holder.description += (holder.description ? '\n' : '') + description;
          holder.descriptionLines.push({
            delimiter,
            description,
            postDelimiter,
            initial,
            type: 'JsdocDescriptionLine'
          });
        }
        return;
      }
      const {
        end: ed,
        delimiter: de,
        postDelimiter: pd,
        start: init,
        ...tkns
      } = tokens;
      if (!tokens.name) {
        let i = 1;
        while (source[idx + i]) {
          const {
            tokens: {
              name,
              postName,
              postType,
              tag: tg
            }
          } = source[idx + i];
          if (tg) {
            break;
          }
          if (name) {
            tkns.postType = postType;
            tkns.name = name;
            tkns.postName = postName;
            break;
          }
          i++;
        }
      }
      let tagInlineTags = [];
      if (tag) {
        // Assuming the tags from `source` are in the same order as `jsdoc.tags`
        // we can use the `tags` length as index into the parser result tags.
        tagInlineTags = jsdoc.tags[tags.length].inlineTags.map(t => inlineTagToAST(t));
      }
      const tagObj = {
        ...tkns,
        initial: endLine ? init : '',
        postDelimiter: lastDescriptionLine ? pd : '',
        delimiter: lastDescriptionLine ? de : '',
        descriptionLines: [],
        inlineTags: tagInlineTags,
        rawType: '',
        type: 'JsdocTag',
        typeLines: []
      };
      tagObj.tag = tagObj.tag.replace(/^@/u, '');
      lastTag = tagObj;
      tags.push(tagObj);
    }
    if (rawType) {
      // Will strip rawType brackets after this tag
      lastTag.typeLines.push(lastTag.typeLines.length ? {
        delimiter,
        postDelimiter,
        rawType,
        initial,
        type: 'JsdocTypeLine'
      } : {
        delimiter: '',
        postDelimiter: '',
        rawType,
        initial: '',
        type: 'JsdocTypeLine'
      });
      lastTag.rawType += lastTag.rawType ? '\n' + rawType : rawType;
    }
    if (description) {
      const holder = lastTag || ast;
      holder.descriptionLines.push(holder.descriptionLines.length ? {
        delimiter,
        description,
        postDelimiter,
        initial,
        type: 'JsdocDescriptionLine'
      } : lastTag ? {
        delimiter: '',
        description,
        postDelimiter: '',
        initial: '',
        type: 'JsdocDescriptionLine'
      } : {
        delimiter,
        description,
        postDelimiter,
        initial,
        type: 'JsdocDescriptionLine'
      });
      if (!tag) {
        holder.description += !holder.description && !lastTag ? description : '\n' + description;
      }
    }

    // Clean-up where last line itself has tag content
    if (end && tag) {
      ast.terminal = end;
      ast.hasPreterminalTagDescription = 1;
      cleanUpLastTag(lastTag);
    }
  });
  ast.lastDescriptionLine = lastDescriptionLine;
  ast.tags = tags;
  return ast;
};
const jsdocVisitorKeys = {
  JsdocBlock: ['descriptionLines', 'tags', 'inlineTags'],
  JsdocDescriptionLine: [],
  JsdocTypeLine: [],
  JsdocTag: ['parsedType', 'typeLines', 'descriptionLines', 'inlineTags'],
  JsdocInlineTag: []
};

/**
 * @callback CommentHandler
 * @param {string} commentSelector
 * @param {import('comment-parser').Block} jsdoc
 * @returns {boolean}
 */

/**
 * @param {{[name: string]: any}} settings
 * @returns {CommentHandler}
 */
const commentHandler = settings => {
  /**
   * @type {CommentHandler}
   */
  return (commentSelector, jsdoc) => {
    const {
      mode
    } = settings;
    const selector = esquery.parse(commentSelector);
    const ast = commentParserToESTree(jsdoc, mode);
    return esquery.matches(ast, selector, null, {
      visitorKeys: {
        ...jsdocTypePrattParser.visitorKeys,
        ...jsdocVisitorKeys
      }
    });
  };
};

/**
 * @param {string} str
 * @returns {string}
 */
const toCamelCase = str => {
  return str.toLowerCase().replaceAll(/^[a-z]/gu, init => {
    return init.toUpperCase();
  }).replaceAll(/_(?<wordInit>[a-z])/gu, (_, n1, o, s, {
    wordInit
  }) => {
    return wordInit.toUpperCase();
  });
};

/**
 * @param {RegExpMatchArray & {
 *   groups: {separator: string, text: string}
 * }} match An inline tag regexp match.
 * @returns {'pipe' | 'plain' | 'prefix' | 'space'}
 */
function determineFormat(match) {
  const {
    separator,
    text
  } = match.groups;
  const [, textEnd] = match.indices.groups.text;
  const [tagStart] = match.indices.groups.tag;
  if (!text) {
    return 'plain';
  } else if (separator === '|') {
    return 'pipe';
  } else if (textEnd < tagStart) {
    return 'prefix';
  }
  return 'space';
}

/**
 * @typedef {{
 *   format: 'pipe' | 'plain' | 'prefix' | 'space',
 *   namepathOrURL: string,
 *   tag: string,
 *   text: string,
 *   start: number,
 *   end: number,
 * }} InlineTag
 */

/**
 * Extracts inline tags from a description.
 * @param {string} description
 * @returns {InlineTag[]} Array of inline tags from the description.
 */
function parseDescription(description) {
  /** @type {InlineTag[]} */
  const result = [];

  // This could have been expressed in a single pattern,
  // but having two avoids a potentially exponential time regex.

  // eslint-disable-next-line prefer-regex-literals -- Need 'd' (indices) flag
  const prefixedTextPattern = new RegExp(/(?:\[(?<text>[^\]]+)\])\{@(?<tag>[^}\s]+)\s?(?<namepathOrURL>[^}\s|]*)\}/gu, 'gud');
  // The pattern used to match for text after tag uses a negative lookbehind
  // on the ']' char to avoid matching the prefixed case too.
  // eslint-disable-next-line prefer-regex-literals -- Need 'd' (indices) flag
  const suffixedAfterPattern = new RegExp(/(?<!\])\{@(?<tag>[^}\s]+)\s?(?<namepathOrURL>[^}\s|]*)\s*(?<separator>[\s|])?\s*(?<text>[^}]*)\}/gu, 'gud');
  const matches = [...description.matchAll(prefixedTextPattern), ...description.matchAll(suffixedAfterPattern)];
  for (const match of matches) {
    const {
      tag,
      namepathOrURL,
      text
    } = match.groups;
    const [start, end] = match.indices[0];
    const format = determineFormat(match);
    result.push({
      tag,
      namepathOrURL,
      text,
      format,
      start,
      end
    });
  }
  return result;
}

/**
 * Splits the `{@prefix}` from remaining `Spec.lines[].token.description`
 * into the `inlineTags` tokens, and populates `spec.inlineTags`
 * @param {import('comment-parser').Block & {
 *   inlineTags: InlineTag[]
 * }} block
 */
function parseInlineTags(block) {
  block.inlineTags = parseDescription(block.description);
  for (const tag of block.tags) {
    /**
     * @type {import('comment-parser').Spec & {
     *   inlineTags: InlineTag[]
     * }}
     */
    tag.inlineTags = parseDescription(tag.description);
  }
  return block;
}

/* eslint-disable prefer-named-capture-group -- Temporary */
const {
  name: nameTokenizer,
  tag: tagTokenizer,
  type: typeTokenizer,
  description: descriptionTokenizer
} = commentParser.tokenizers;

/**
 * @param {import('comment-parser').Spec} spec
 * @returns {boolean}
 */
const hasSeeWithLink = spec => {
  return spec.tag === 'see' && /\{@link.+?\}/u.test(spec.source[0].source);
};
const defaultNoTypes = ['default', 'defaultvalue', 'description', 'example', 'file', 'fileoverview', 'license', 'overview', 'see', 'summary'];
const defaultNoNames = ['access', 'author', 'default', 'defaultvalue', 'description', 'example', 'exception', 'file', 'fileoverview', 'kind', 'license', 'overview', 'return', 'returns', 'since', 'summary', 'throws', 'version', 'variation'];
const optionalBrackets = /^\[(?<name>[^=]*)=[^\]]*\]/u;
const preserveTypeTokenizer = typeTokenizer('preserve');
const preserveDescriptionTokenizer = descriptionTokenizer('preserve');
const plainNameTokenizer = nameTokenizer();
const getTokenizers = ({
  noTypes = defaultNoTypes,
  noNames = defaultNoNames
} = {}) => {
  // trim
  return [
  // Tag
  tagTokenizer(),
  // Type
  spec => {
    if (noTypes.includes(spec.tag)) {
      return spec;
    }
    return preserveTypeTokenizer(spec);
  },
  // Name
  spec => {
    if (spec.tag === 'template') {
      // const preWS = spec.postTag;
      const remainder = spec.source[0].tokens.description;
      const pos = remainder.search(/(?<![\s,])\s/u);
      let name = pos === -1 ? remainder : remainder.slice(0, pos);
      const extra = remainder.slice(pos);
      let postName = '',
        description = '',
        lineEnd = '';
      if (pos > -1) {
        [, postName, description, lineEnd] = extra.match(/(\s*)([^\r]*)(\r)?/u);
      }
      if (optionalBrackets.test(name)) {
        var _name$match, _name$match$groups;
        name = (_name$match = name.match(optionalBrackets)) === null || _name$match === void 0 ? void 0 : (_name$match$groups = _name$match.groups) === null || _name$match$groups === void 0 ? void 0 : _name$match$groups.name;
        spec.optional = true;
      } else {
        spec.optional = false;
      }
      spec.name = name;
      const {
        tokens
      } = spec.source[0];
      tokens.name = name;
      tokens.postName = postName;
      tokens.description = description;
      tokens.lineEnd = lineEnd || '';
      return spec;
    }
    if (noNames.includes(spec.tag) || hasSeeWithLink(spec)) {
      return spec;
    }
    return plainNameTokenizer(spec);
  },
  // Description
  spec => {
    return preserveDescriptionTokenizer(spec);
  }];
};

/**
 * Accepts a comment token and converts it into `comment-parser` AST.
 * @param {PlainObject} commentNode
 * @param {string} [indent=""] Whitespace
 * @returns {PlainObject}
 */
const parseComment = (commentNode, indent = '') => {
  // Preserve JSDoc block start/end indentation.
  const [block] = commentParser.parse(`${indent}/*${commentNode.value}*/`, {
    // @see https://github.com/yavorskiy/comment-parser/issues/21
    tokenizers: getTokenizers()
  });
  return parseInlineTags(block);
};

/**
 * Obtained originally from {@link https://github.com/eslint/eslint/blob/master/lib/util/source-code.js#L313}.
 *
 * @license MIT
 */

/**
 * Checks if the given token is a comment token or not.
 *
 * @param {Token} token - The token to check.
 * @returns {boolean} `true` if the token is a comment token.
 */
const isCommentToken = token => {
  return token.type === 'Line' || token.type === 'Block' || token.type === 'Shebang';
};

/**
 * @param {AST} node
 * @returns {boolean}
 */
const getDecorator = node => {
  var _node$declaration, _node$declaration$dec, _node$decorators, _node$parent, _node$parent$decorato;
  return (node === null || node === void 0 ? void 0 : (_node$declaration = node.declaration) === null || _node$declaration === void 0 ? void 0 : (_node$declaration$dec = _node$declaration.decorators) === null || _node$declaration$dec === void 0 ? void 0 : _node$declaration$dec[0]) || (node === null || node === void 0 ? void 0 : (_node$decorators = node.decorators) === null || _node$decorators === void 0 ? void 0 : _node$decorators[0]) || (node === null || node === void 0 ? void 0 : (_node$parent = node.parent) === null || _node$parent === void 0 ? void 0 : (_node$parent$decorato = _node$parent.decorators) === null || _node$parent$decorato === void 0 ? void 0 : _node$parent$decorato[0]);
};

/**
 * Check to see if it is a ES6 export declaration.
 *
 * @param {ASTNode} astNode An AST node.
 * @returns {boolean} whether the given node represents an export declaration.
 * @private
 */
const looksLikeExport = function (astNode) {
  return astNode.type === 'ExportDefaultDeclaration' || astNode.type === 'ExportNamedDeclaration' || astNode.type === 'ExportAllDeclaration' || astNode.type === 'ExportSpecifier';
};

/**
 * @param {AST} astNode
 * @returns {AST}
 */
const getTSFunctionComment = function (astNode) {
  const {
    parent
  } = astNode;
  const grandparent = parent.parent;
  const greatGrandparent = grandparent.parent;
  const greatGreatGrandparent = greatGrandparent && greatGrandparent.parent;

  // istanbul ignore if
  if (parent.type !== 'TSTypeAnnotation') {
    return astNode;
  }
  switch (grandparent.type) {
    case 'PropertyDefinition':
    case 'ClassProperty':
    case 'TSDeclareFunction':
    case 'TSMethodSignature':
    case 'TSPropertySignature':
      return grandparent;
    case 'ArrowFunctionExpression':
      // istanbul ignore else
      if (greatGrandparent.type === 'VariableDeclarator'

      // && greatGreatGrandparent.parent.type === 'VariableDeclaration'
      ) {
        return greatGreatGrandparent.parent;
      }

      // istanbul ignore next
      return astNode;
    case 'FunctionExpression':
      // istanbul ignore else
      if (greatGrandparent.type === 'MethodDefinition') {
        return greatGrandparent;
      }

    // Fallthrough
    default:
      // istanbul ignore if
      if (grandparent.type !== 'Identifier') {
        // istanbul ignore next
        return astNode;
      }
  }

  // istanbul ignore next
  switch (greatGrandparent.type) {
    case 'ArrowFunctionExpression':
      // istanbul ignore else
      if (greatGreatGrandparent.type === 'VariableDeclarator' && greatGreatGrandparent.parent.type === 'VariableDeclaration') {
        return greatGreatGrandparent.parent;
      }

      // istanbul ignore next
      return astNode;
    case 'FunctionDeclaration':
      return greatGrandparent;
    case 'VariableDeclarator':
      // istanbul ignore else
      if (greatGreatGrandparent.type === 'VariableDeclaration') {
        return greatGreatGrandparent;
      }

    // Fallthrough
    default:
      // istanbul ignore next
      return astNode;
  }
};
const invokedExpression = new Set(['CallExpression', 'OptionalCallExpression', 'NewExpression']);
const allowableCommentNode = new Set(['AssignmentPattern', 'VariableDeclaration', 'ExpressionStatement', 'MethodDefinition', 'Property', 'ObjectProperty', 'ClassProperty', 'PropertyDefinition', 'ExportDefaultDeclaration', 'ReturnStatement']);

/**
 * Reduces the provided node to the appropriate node for evaluating
 * JSDoc comment status.
 *
 * @param {ASTNode} node An AST node.
 * @param {SourceCode} sourceCode The ESLint SourceCode.
 * @returns {ASTNode} The AST node that can be evaluated for appropriate
 * JSDoc comments.
 */
const getReducedASTNode = function (node, sourceCode) {
  let {
    parent
  } = node;
  switch (node.type) {
    case 'TSFunctionType':
      return getTSFunctionComment(node);
    case 'TSInterfaceDeclaration':
    case 'TSTypeAliasDeclaration':
    case 'TSEnumDeclaration':
    case 'ClassDeclaration':
    case 'FunctionDeclaration':
      return looksLikeExport(parent) ? parent : node;
    case 'TSDeclareFunction':
    case 'ClassExpression':
    case 'ObjectExpression':
    case 'ArrowFunctionExpression':
    case 'TSEmptyBodyFunctionExpression':
    case 'FunctionExpression':
      if (!invokedExpression.has(parent.type)) {
        let token = node;
        do {
          token = sourceCode.getTokenBefore(token, {
            includeComments: true
          });
        } while (token && token.type === 'Punctuator' && token.value === '(');
        if (token && token.type === 'Block') {
          return node;
        }
        if (sourceCode.getCommentsBefore(node).length) {
          return node;
        }
        while (!sourceCode.getCommentsBefore(parent).length && !/Function/u.test(parent.type) && !allowableCommentNode.has(parent.type)) {
          ({
            parent
          } = parent);
          if (!parent) {
            break;
          }
        }
        if (parent && parent.type !== 'FunctionDeclaration' && parent.type !== 'Program') {
          if (parent.parent && parent.parent.type === 'ExportNamedDeclaration') {
            return parent.parent;
          }
          return parent;
        }
      }
      return node;
    default:
      return node;
  }
};

/**
 * Checks for the presence of a JSDoc comment for the given node and returns it.
 *
 * @param {ASTNode} astNode The AST node to get the comment for.
 * @param {SourceCode} sourceCode
 * @param {{maxLines: Integer, minLines: Integer}} settings
 * @returns {Token|null} The Block comment token containing the JSDoc comment
 *    for the given node or null if not found.
 * @private
 */
const findJSDocComment = (astNode, sourceCode, settings) => {
  const {
    minLines,
    maxLines
  } = settings;
  let currentNode = astNode;
  let tokenBefore = null;
  while (currentNode) {
    const decorator = getDecorator(currentNode);
    if (decorator) {
      currentNode = decorator;
    }
    tokenBefore = sourceCode.getTokenBefore(currentNode, {
      includeComments: true
    });
    if (tokenBefore && tokenBefore.type === 'Punctuator' && tokenBefore.value === '(') {
      [tokenBefore] = sourceCode.getTokensBefore(currentNode, {
        count: 2,
        includeComments: true
      });
    }
    if (!tokenBefore || !isCommentToken(tokenBefore)) {
      return null;
    }
    if (tokenBefore.type === 'Line') {
      currentNode = tokenBefore;
      continue;
    }
    break;
  }
  if (tokenBefore.type === 'Block' && /^\*\s/u.test(tokenBefore.value) && currentNode.loc.start.line - tokenBefore.loc.end.line >= minLines && currentNode.loc.start.line - tokenBefore.loc.end.line <= maxLines) {
    return tokenBefore;
  }
  return null;
};

/**
 * Retrieves the JSDoc comment for a given node.
 *
 * @param {SourceCode} sourceCode The ESLint SourceCode
 * @param {ASTNode} node The AST node to get the comment for.
 * @param {PlainObject} settings The settings in context
 * @returns {Token|null} The Block comment token containing the JSDoc comment
 *    for the given node or null if not found.
 * @public
 */
const getJSDocComment = function (sourceCode, node, settings) {
  const reducedNode = getReducedASTNode(node, sourceCode);
  return findJSDocComment(reducedNode, sourceCode, settings);
};

/**
 * @typedef {{preferRawType?: boolean}} ESTreeToStringOptions
 */

const stringifiers = {
  /**
   * @param {import('./commentParserToESTree.js').JsdocBlock} node
   * @param {ESTreeToStringOptions} opts
   * @param {string[]} descriptionLines
   * @param {string[]} tags
   * @returns {string}
   */
  JsdocBlock({
    delimiter,
    postDelimiter,
    lineEnd,
    initial,
    terminal,
    endLine
  }, opts, descriptionLines, tags) {
    const alreadyHasLine = descriptionLines.length && !tags.length && descriptionLines.at(-1).endsWith('\n') || tags.length && tags.at(-1).endsWith('\n');
    return `${initial}${delimiter}${postDelimiter}${endLine ? `
` : ''}${
    // Could use `node.description` (and `node.lineEnd`), but lines may have
    //   been modified
    descriptionLines.length ? descriptionLines.join(lineEnd + '\n') + (tags.length ? lineEnd + '\n' : '') : ''}${tags.length ? tags.join(lineEnd + '\n') : ''}${endLine && !alreadyHasLine ? `${lineEnd}
 ${initial}` : endLine ? ` ${initial}` : ''}${terminal}`;
  },
  /**
   * @param {import('./commentParserToESTree.js').JsdocDescriptionLine} node
   * @returns {string}
   */
  JsdocDescriptionLine({
    initial,
    delimiter,
    postDelimiter,
    description
  }) {
    return `${initial}${delimiter}${postDelimiter}${description}`;
  },
  /**
   * @param {import('./commentParserToESTree.js').JsdocTypeLine} node
   * @returns {string}
   */
  JsdocTypeLine({
    initial,
    delimiter,
    postDelimiter,
    rawType
  }) {
    return `${initial}${delimiter}${postDelimiter}${rawType}`;
  },
  /**
   * @param {import('./commentParserToESTree.js').JsdocInlineTag} node
   */
  JsdocInlineTag({
    format,
    namepathOrURL,
    tag,
    text
  }) {
    return format === 'pipe' ? `{@${tag} ${namepathOrURL}|${text}}` : format === 'plain' ? `{@${tag} ${namepathOrURL}}` : format === 'prefix' ? `[${text}]{@${tag} ${namepathOrURL}}`
    // "space"
    : `{@${tag} ${namepathOrURL} ${text}}`;
  },
  /**
   * @param {import('./commentParserToESTree.js').JsdocTag} node
   * @param {ESTreeToStringOptions} opts
   * @param {string} parsedType
   * @param {string[]} typeLines
   * @param {string[]} descriptionLines
   * @returns {string}
   */
  JsdocTag(node, opts, parsedType, typeLines, descriptionLines) {
    const {
      description,
      name,
      postName,
      postTag,
      postType,
      initial,
      delimiter,
      postDelimiter,
      tag
      // , rawType
    } = node;
    return `${initial}${delimiter}${postDelimiter}@${tag}${postTag}${
    // Could do `rawType` but may have been changed; could also do
    //   `typeLines` but not as likely to be changed
    // parsedType
    // Comment this out later in favor of `parsedType`
    // We can't use raw `typeLines` as first argument has delimiter on it
    opts.preferRawType || !parsedType ? typeLines.length ? `{${typeLines.join('\n')}}` : '' : parsedType}${postType}${name ? `${name}${postName || (description ? '\n' : '')}` : ''}${descriptionLines.join('\n')}`;
  }
};
const visitorKeys = {
  ...jsdocVisitorKeys,
  ...jsdocTypePrattParser.visitorKeys
};

/**
 * @todo convert for use by escodegen (until may be patched to support
 *   custom entries?).
 * @param {import('./commentParserToESTree.js').JsdocBlock|
 *   import('./commentParserToESTree.js').JsdocDescriptionLine|
 *   import('./commentParserToESTree.js').JsdocTypeLine|
 *   import('./commentParserToESTree.js').JsdocTag|
 *   import('./commentParserToESTree.js').JsdocInlineTag|
 *   import('jsdoc-type-pratt-parser').RootResult
 * } node
 * @param {ESTreeToStringOptions} opts
 * @throws {Error}
 * @returns {string}
 */
function estreeToString(node, opts = {}) {
  if (Object.prototype.hasOwnProperty.call(stringifiers, node.type)) {
    const childNodeOrArray = visitorKeys[node.type];
    const args = /** @type {(string[]|string|null)[]} */
    childNodeOrArray.map(key => {
      // @ts-expect-error
      return Array.isArray(node[key])
      // @ts-expect-error
      ? node[key].map((
      /**
       * @type {import('./commentParserToESTree.js').JsdocBlock|
       *   import('./commentParserToESTree.js').JsdocDescriptionLine|
       *   import('./commentParserToESTree.js').JsdocTypeLine|
       *   import('./commentParserToESTree.js').JsdocTag|
       *   import('./commentParserToESTree.js').JsdocInlineTag}
       */
      item) => {
        return estreeToString(item, opts);
      })
      // @ts-expect-error
      : node[key] === undefined || node[key] === null ? null
      // @ts-expect-error
      : estreeToString(node[key], opts);
    });
    return stringifiers[
    /**
     * @type {import('./commentParserToESTree.js').JsdocBlock|
     *   import('./commentParserToESTree.js').JsdocDescriptionLine|
     *   import('./commentParserToESTree.js').JsdocTypeLine|
     *   import('./commentParserToESTree.js').JsdocTag}
     */
    node.type](node, opts,
    // @ts-expect-error
    ...args);
  }

  // We use raw type instead but it is a key as other apps may wish to traverse
  if (node.type.startsWith('JsdocType')) {
    return opts.preferRawType ? '' : `{${jsdocTypePrattParser.stringify( /** @type {import('jsdoc-type-pratt-parser').RootResult} */
    node)}}`;
  }
  throw new Error(`Unhandled node type: ${node.type}`);
}

Object.defineProperty(exports, 'jsdocTypeVisitorKeys', {
  enumerable: true,
  get: function () { return jsdocTypePrattParser.visitorKeys; }
});
exports.commentHandler = commentHandler;
exports.commentParserToESTree = commentParserToESTree;
exports.defaultNoNames = defaultNoNames;
exports.defaultNoTypes = defaultNoTypes;
exports.estreeToString = estreeToString;
exports.findJSDocComment = findJSDocComment;
exports.getDecorator = getDecorator;
exports.getJSDocComment = getJSDocComment;
exports.getReducedASTNode = getReducedASTNode;
exports.getTokenizers = getTokenizers;
exports.hasSeeWithLink = hasSeeWithLink;
exports.jsdocVisitorKeys = jsdocVisitorKeys;
exports.parseComment = parseComment;
exports.toCamelCase = toCamelCase;
Object.keys(jsdocTypePrattParser).forEach(function (k) {
  if (k !== 'default' && !exports.hasOwnProperty(k)) Object.defineProperty(exports, k, {
    enumerable: true,
    get: function () { return jsdocTypePrattParser[k]; }
  });
});
