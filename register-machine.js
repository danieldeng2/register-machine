// Copyright 2019 by Robert Kovacsics
//
// Permission is hereby granted, free of charge, to any person
// obtaining a copy of this software and associated documentation
// files (the "Software"), to deal in the Software without
// restriction, including without limitation the rights to use, copy,
// modify, merge, publish, distribute, sublicense, and/or sell copies
// of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS
// BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
// ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
// CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

"use strict";

function lower(s) { if (typeof s == "string") return s.toLowerCase(); else return s; }
var parser_line = 1;

function Newline() { ++parser_line; }
function Label(s, str) { this.str = s; this.line = parser_line;
                         this.name = lower(str); }
function Trace(s) { this.str = s; this.line = parser_line; }
function Init(s, reg, val) { this.str = s; this.line = parser_line;
                             this.reg = lower(reg); this.val = parseInt(val); }
function Inc(s, reg, next) { this.str = s; this.line = parser_line;
                             this.reg = lower(reg); this.next = lower(next); }
function Dec(s, reg, tru, fals) { this.str = s; this.line = parser_line;
                                  this.reg = lower(reg);
                                  this.tru = lower(tru); this.fals = lower(fals); }
function Halt(s, reason) { this.str = s; this.line = parser_line;
                           this.reason = reason; }
function Eval(s, desc, reg, code) { this.str = s; this.line = parser_line;
                                    this.desc = desc; this.reg = lower(reg); this.code = code; }

var parseTable =
    [[/\n/y, Newline],
     [/\/\/[^\n]*/y, null],
     [/\s+/y, null],
     [/(\w+):/y, (s, lbl) => new Label(s, lbl)],
     [/trace/yi, (s) => new Trace(s)],
     [/init (\w+) (\d+)/yi, (s, r, v)   => new Init(s, r, v)],
     [/(\w+)\+\s*->\s*(\w+)/y,     (s, r, next)   => new Inc(s, r, next)],
     [/(\w+)\+\s*->\s*([+-]\d+)/y, (s, r, offset) => new Inc(s, r, parseInt(offset))],
     [/(\w+)\+/y,                  (s, r)         => new Inc(s, r, +1)],
     [/(\w+)-\s*->\s*(\w+)\s*,\s*(\w+)/y,         (s, r, tru, fals) => new Dec(s, r, tru,           fals)],
     [/(\w+)-\s*->\s*([+-]\d+)\s*,\s*([+-]\d+)/y, (s, r, tru, fals) => new Dec(s, r, parseInt(tru), parseInt(fals))],
     [/(\w+)-\s*->\s*,\s*(\w+)/y,                 (s, r, fals)      => new Dec(s, r, +1,            fals)],
     [/(\w+)-\s*->\s*,\s*([+-]\d+)/y,             (s, r, fals)      => new Dec(s, r, +1,            parseInt(fals))],
     [/(\w+)-\s*->\s*(\w+)\s*,?/y,                (s, r, tru)       => new Dec(s, r, tru,           +1)],
     [/(\w+)-\s*->\s*([+-]\d+)\s*,?/y,            (s, r, tru)       => new Dec(s, r, parseInt(tru), +1)],
     [/(\w+)-\s*/y,                               (s, r, tru)       => new Dec(s, r, +1,            +1)],
     [/halt\s+"([^"]*)"/yi, (s, reason) => new Halt(s, reason)],
     [/halt/yi,             (s)         => new Halt(s, "Halt")],
     [/eval\s+"([^"]*)"\s+(\w+)\s*::=\s*([^;]*);/yi, (s, desc, reg, code) => new Eval(s, desc, reg, code)]
    ];

function parse(input, log_fn) {
  let matched = true;
  let index = 0;
  let tokens = [];
  parser_line = 1;
  while (matched) {
    matched = false;
    for (let [re, fn] of parseTable) {
      console.assert(re.sticky, `RegExp ${re.toString()} should be sticky!`);
      re.lastIndex = index;
      let m = re.exec(input);
      if (m != null) {
        matched = true;
        index = re.lastIndex;
        if (fn) {
          let matchArray = Array.from(m);
          let fn_res = fn.apply(undefined, matchArray);
          if (fn_res) tokens.push(fn_res);
        }
        break;
      }
    }
  }
  if (index != input.length) {
    let line = (input.substring(0, index).match(/\n/g)||[]).length+1
    log_fn(`Failed to fully parse input, problem on line ${line} from ${input.substring(index)}\n`);
    throw "Parsing failure";
  }
  return tokens;
}

// The instanceof is not the best from a maintenance perspective, but
// suffices here
function resolve(tokens, log_fn) {
  let trace = false;
  let label = null;
  let newTokens = [];
  let index = 0;
  let labelMap = new Map();
  for (let token of tokens) {
    if (token instanceof Label) {
      label = token.name;
      labelMap.set(label, index);
    } else if (token instanceof Trace) {
      trace = true;
    } else {
      token.trace = trace;
      token.label = label;
      newTokens.push(token);
      trace = false;
      label = null;
      ++index;
    }
  }

  index = 0;
  function fixup(token, prop, index, log_fn) {
    if (typeof token[prop] == "string") {
      if (/^\d+$/.test(token[prop])) { // Absolute label
        token[prop] = parseInt(token[prop]);
      } else { // String label
        let new_prop = labelMap.get(token[prop]);
        if(new_prop === undefined) {
            log_fn(`Could not find label ${token[prop]}!`);
            throw "Looking up label fail!";
        }
        token[prop] = new_prop
      }
    } else if (typeof token[prop] == "number") {
      // Convert relative to absolute
      token[prop] += index;
    }
  }
  for (let token of newTokens) {
    if (token instanceof Inc) {
      fixup(token, "next", index, log_fn);
    } else if (token instanceof Dec) {
      fixup(token, "tru", index, log_fn);
      fixup(token, "fals", index, log_fn);
    }
    ++index;
  }
  return newTokens;
}

function evaluate(tokens, trace_fn, argsArray) {
  let steps = 0;
  let index = 0;
  let regs = new Map();
  regs.at = function(idx) {
    if (!this.has(idx)) this.set(idx, 0);
    return this.get(idx);
  }
  argsArray.forEach((v, i) => regs.set(`R${i}`, v));
  while (true) {
    let at_pc = tokens[index];
    if (at_pc instanceof Init) {
      if (at_pc.trace) trace_fn(`line ${at_pc.line}: Initialising: ${at_pc.reg} with ${at_pc.val}\n`);
      regs.set(at_pc.reg, at_pc.val);
      ++index;
    } else if (at_pc instanceof Halt) {
      if (at_pc.trace) trace_fn(`line ${at_pc.line}: Halting: ${at_pc.reason}\n`);
      break;
    } else if (at_pc instanceof Inc) {
      let r = at_pc.reg;
      if (at_pc.trace) trace_fn(`line ${at_pc.line}: ${at_pc.str} was ${regs.at(r)}\n`);
      regs.set(r, regs.at(r)+1);
      index = at_pc.next;
    } else if (at_pc instanceof Dec) {
      let r = at_pc.reg;
      if (at_pc.trace) trace_fn(`line ${at_pc.line}: ${at_pc.str} was ${regs.at(r)}\n`);
      if (regs.at(r) > 0) {
        regs.set(r, regs.at(r)-1);
        index = at_pc.tru;
      } else {
        index = at_pc.fals;
      }
    } else if (at_pc instanceof Eval) {
      // Construct
      let r = at_pc.reg;
      if (at_pc.trace) trace_fn(`line ${at_pc.line}: ${r} ::= ${at_pc.desc}\n`);
      let code = "{ ";
      for (let [k,v] of regs) { code += `let ${k} = ${JSON.stringify(v)};\n  `; }
      code += at_pc.code + "}";
      regs.set(r, eval(code));
      ++index;
    }
    if (index >= tokens.length) {
      trace_fn(`PC out of bounds from instruction line ${at_pc.line}: ${at_pc.str}`);
      throw "PC out of bounds"
    }
    if (++steps > 1000) {
      trace_fn("Done 1000 steps, bailing!");
      break;
    }
  }
  return regs;
}

function to_dot(tokens) {
  let nodes = "  Start [shape=box];\n";
  let edges = "";
  let index = 0;

  for (let token of tokens) {
    if ((!(token instanceof Init)) && edges == "") {
      edges += `  Start -> ${index};\n`;
    }

    if (token instanceof Inc) {
      nodes += `  ${index} [label="${token.reg}+"];\n`;
      edges += `  ${index} -> ${token.next};\n`;
    } else if (token instanceof Dec) {
      nodes += `  ${index} [label="${token.reg}-"];\n`;
      edges += `  ${index} -> ${token.tru};\n`;
      edges += `  ${index} -> ${token.fals} [arrowhead="veevee"];\n`;
    } else if (token instanceof Halt) {
      nodes += `  ${index} [label="${token.reason}",shape=box];\n`;
    } else if (token instanceof Eval) {
      nodes += `  ${index} [label="${token.desc}",shape=box];\n`;
      edges += `  ${index} -> ${index+1};\n`;
    } else if (token instanceof Init) {
    } else {
      console.assert(false, "Unknown token: ", token);
    }
    ++index;
  }

  let output = "digraph {\n";
  output += nodes;
  output += edges;
  output += "}\n";
  return output;
}

function to_vis(tokens) {
  let nodes = [{id: -1, label: "Start", shape: "box"}];
  let edges = [];
  let index = 0;

  for (let token of tokens) {
    if ((!(token instanceof Init)) && edges.length == "") {
      edges.push({from: -1, to: index, arrows: "to"});
    }

    if (token instanceof Inc) {
      nodes.push({id: index, label: `${token.reg}+`});
      edges.push({from: index, to: token.next, arrows: "to"});
    } else if (token instanceof Dec) {
      nodes.push({id: index, label: `${token.reg}-`});
      edges.push({from: index, to: token.tru, arrows: "to"});
      edges.push({from: index, to: token.fals, arrows: "to, middle"});
    } else if (token instanceof Eval) {
      nodes.push({id: index, label: token.desc, shape: "box"});
      edges.push({from: index, to: index+1, arrows: "to"});
    } else if (token instanceof Halt) {
      nodes.push({id: index, label: `${token.reason}`, shape: "box"});
    } else if (token instanceof Init) {
    } else {
      console.assert(false, "Unknown token: ", token);
    }
    ++index;
  }

  return { nodes: nodes, edges: edges };
}

var parsed = null;
var linked = null;
var RM = null;
var result_regs = null;

function closestHTMLneighbour(source, direction, target) {
  while (source != null && source.tagName != target) {
    while ((direction < 0 ? source.previousElementSibling
                          : source.nextElementSibling) == null) {
      source = source.parentElement;
      if (source == null) return null;
    }
    source = direction < 0 ? source.previousElementSibling
                           : source.nextElementSibling;

    if (source.tagName != target &&
        source.hasChildNodes() && source.children.length > 0)
      source = direction < 0 ? source.lastElementChild
                             : source.firstElementChild;
  }
  return source;
}

function log_fn (output, cause) {
  let d = document.createElement("div");
  output.prepend(d);
  let empty = true;
  return text => {
    if (empty) {
      empty = false;
      d.innerText = `Log [${cause}]:\n`;
    }
    d.innerText += text;
  }
}


let encodeTrace;

function encode_rm(btn) {
  let textarea = closestHTMLneighbour(btn, -1, "TEXTAREA");
  let output = closestHTMLneighbour(btn, 1, "BLOCKQUOTE");
  console.assert(textarea != null, "Couldn't find textarea above button!");
  console.assert(output != null, "Couldn't find output below button!");
  let ruler = document.createElement("hr");
  output.prepend(ruler)
  let regs_output = document.createElement("div");
  encodeTrace = regs_output;
  regs_output.innerText = "Encoded lines:\n";
  output.prepend(regs_output)


  parsed = parse(textarea.value, log_fn(output, "Parse"));
  let program = [];

  for (let line of parsed){
    const lineEncoded = encode_line(line, regs_output);
    program.push(lineEncoded);
  }

  regs_output.innerText += `Encoded program: ${encodeList(program)}\n`;
}

function encode_line(line) {
  if (line instanceof Label){
    encodeTrace.innerText += `${line.str} `;
    return -1;
  } 

  encodeTrace.innerText += line.str + "\n";

  let value;

  if (line instanceof Inc){
    let regNum = parseInt(line.reg.substring(1));
    let nextNum = parseInt(line.next.substring(1));

    value =  encodeBigPair (2*regNum, nextNum, encodeTrace);
  }

  if (line instanceof Halt){
    value = 0;
  }

  if (line instanceof Dec){
    let regNum = parseInt(line.reg.substring(1));
    let truNum = parseInt(line.tru.substring(1));
    let falsNum = parseInt(line.fals.substring(1));

    encodeTrace.innerText += "RHS= ";
    let RHS = encodeSmallPair(truNum, falsNum, encodeTrace);
    encodeTrace.innerText += `=${RHS}\n`;
    value = encodeBigPair(2*regNum + 1, RHS, encodeTrace);
  }

  if (value !== undefined) encodeTrace.innerText += `=${value}\n`;

  encodeTrace.innerText += `\n`;
  return value;
}

// <<x,y>>
function encodeBigPair (x, y){
  encodeTrace.innerText += `<< ${x} , ${y} >> = 2^${x}*(2*${y} + 1)\n`;
  return Math.pow(2, x)*(2*y + 1);
}

// <x,y>
function encodeSmallPair (x, y){
  encodeTrace.innerText += `< ${x} , ${y} > = 2^${x}*(2*${y} + 1) - 1\n`;
  return Math.pow(2, x)*(2*y + 1) - 1;
}

function encodeList(list){
  if (list.length == 0) return 0;
  return encodeBigPair(list[0], encodeList(list.slice(1)));
}

function decodeList(num, powerOf2 = 0) {
  const list = [];
  let currVal = 0;
  encodeTrace.innerText += `${num} = ${num.toString(2)}\n`;
  let listText = `2^${powerOf2} * ${num} = [`
  while (num != 0) {
    if (num % 2 == 0){
      currVal++;
    } else {
      list.push(currVal);
      currVal = 0;
    }
    num = num >>> 1;
  }
  list[0] = powerOf2 + list[0];

  listText += `${list.join(",")}] \n\n`;
  encodeTrace.innerText += listText;
  
  return list;
}

function decodeLine(inputElem) {
  let numberBox = document.querySelector(inputElem);
  let output = document.querySelector("#output");
  let ruler = document.createElement("hr");
  output.prepend(ruler)
  let regs_output = document.createElement("div");
  encodeTrace = regs_output;
  regs_output.innerText = "Decoded line: \n";
  output.prepend(regs_output)

  let instruction = decodeInstruction(numberBox.value);
  regs_output.innerText += instruction.str;
}

function decodeBigPair(num, open='<<', close='>>') {
  let first = 0;
  encodeTrace.innerText += `${num} = `

  while (num % 2 == 0) {
    first++;
    num = num / 2;
  }
  let second = (num-1)/2;
  encodeTrace.innerText += `2^${first}*${num} = ${open}${first}, ${second}${close}\n`

  return [first, second];
}

function decodeSmallPair(num) {
  return decodeBigPair(num + 1, '<', '>');
}


function decodeInstruction(num) {
  if (num == 0) {
    return new Halt("Halt", "");
  } 
  
  const [y,z] = decodeBigPair(num);

  if (y % 2 == 0){
    const r = y / 2;
    encodeTrace.innerText += "first element is even therefore plus instruction\n"
    return new Inc(`R${r}+ -> L${z}`, `r${r}`, `l${z}`);
  }

  const r = (y - 1) / 2;
  encodeTrace.innerText += "first element is odd therefore minus instruction\n"
  const [j, k] = decodeSmallPair(z);
  return new Dec(`R${r}- -> L${j}, L${k}`, `r${r}`, `l${j}`,  `l${k}`);
}

function decodeRM(idPower, idNum) {
  let output = document.querySelector("#output");

  let ruler = document.createElement("hr");
  output.prepend(ruler)
  let regs_output = document.createElement("div");
  encodeTrace = regs_output;
  regs_output.innerText = "Decoded program: \n";
  output.prepend(regs_output)

  const powerBox = document.querySelector(idPower);
  const numBox = document.querySelector(idNum);

  let numList = decodeList(parseInt(numBox.value), parseInt(powerBox.value));

  let returnText = "";

  for (let [index, value] of numList.entries()) {
    let instruct = decodeInstruction(value);
    let lineText = `L${index}: ${instruct.str}\n`;
    returnText += lineText;
    encodeTrace.innerText += lineText + "\n\n";
  }
  document.querySelector("#progIn").textContent = returnText;
}

function run_rm(btn) {
  let textarea = closestHTMLneighbour(btn, -1, "TEXTAREA");
  let output = closestHTMLneighbour(btn, 1, "BLOCKQUOTE");
  console.assert(textarea != null, "Couldn't find textarea above button!");
  console.assert(output != null, "Couldn't find output below button!");
  let ruler = document.createElement("hr");
  output.prepend(ruler)

  parsed = parse(textarea.value, log_fn(output, "Parse"));
  linked = resolve(parsed, log_fn(output, "Link"));

  RM = (...regs) => evaluate(linked, log_fn(output, "Trace"), regs);
  result_regs = RM();

  let regs_output = document.createElement("div");
  regs_output.innerText = "Register values on completion:\n";
  output.prepend(regs_output)
  for (let [reg,val] of Array.from(result_regs).sort()) {
    regs_output.innerText += `${reg}: ${JSON.stringify(val)}\n`
  }
}



function plot_rm(btn, height) {
  if (height === undefined) height = `${Math.round(window.innerHeight * 0.85)}px`;
  let textarea = closestHTMLneighbour(btn, -1, "TEXTAREA");
  let output = closestHTMLneighbour(btn, 1, "BLOCKQUOTE");
  console.assert(textarea != null, "Couldn't find textarea above button!");
  console.assert(output != null, "Couldn't find output below button!");
  let ruler = document.createElement("hr");
  output.prepend(ruler)

  parsed = parse(textarea.value, log_fn(output, "Parse"));
  linked = resolve(parsed, log_fn(output, "Link"));

  let graph_output = document.createElement("p");
  output.prepend(graph_output);
  let graph_options = {
    height: height
  };
  let machine_graph = new vis.Network(graph_output, to_vis(linked), graph_options);
}