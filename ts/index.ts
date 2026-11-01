/*******************************************************************************
 * Copyright (c) 2023-2026 Maxprograms.
 *
 * This program and the accompanying materials
 * are made available under the terms of the Eclipse   License 1.0
 * which accompanies this distribution, and is available at
 * https://www.eclipse.org/org/documents/epl-v10.html
 *
 * Contributors:
 *     Maxprograms - initial API and implementation
 *******************************************************************************/

// Core classes
export { CData } from "./CData.js";
export { Catalog } from "./Catalog.js";
export { Constants } from "./Constants.js";
export { ContentHandler } from "./ContentHandler.js";
export { DOMBuilder } from "./DOMBuilder.js";
export { FileReader } from "./FileReader.js";
export { Indenter } from "./Indenter.js";
export { ProcessingInstruction } from "./ProcessingInstruction.js";
export { RelaxNGParser } from "./RelaxNGParser.js";
export { SAXParser } from "./SAXParser.js";
export type { ParseSourceOptions, StreamParseOptions } from "./SAXParser.js";
export { TextNode } from "./TextNode.js";
export { XMLAttribute } from "./XMLAttribute.js";
export { XMLCanonicalizer } from "./XMLCanonicalizer.js";
export { XMLComment } from "./XMLComment.js";
export { XMLDeclaration } from "./XMLDeclaration.js";
export { XMLDocument } from "./XMLDocument.js";
export { XMLDocumentType } from "./XMLDocumentType.js";
export { XMLElement } from "./XMLElement.js";
export { XMLNode } from "./XMLNode.js";
export { XMLUtils } from "./XMLUtils.js";
export { XMLWriter } from "./XMLWriter.js";

// DTD classes
export { AttDecl } from "./dtd/AttDecl.js";
export { AttListDecl } from "./dtd/AttListDecl.js";
export { Cardinality, ContentModel, ContentModelType } from "./dtd/ContentModel.js";
export { DTDParser } from "./dtd/DTDParser.js";
export { DTDChoice } from "./dtd/dtdChoice.js";
export { DTDChoiceModel } from "./dtd/DTDChoiceModel.js";
export type { DTDContentModel } from "./dtd/DTDContentModel.js";
export { DTDContentModelParser } from "./dtd/DTDContentModelParser.js";
export { DTDContentModelTokenizer } from "./dtd/DTDContentModelTokenizer.js";
export type { DTDToken } from "./dtd/DTDContentModelTokenizer.js";
export { DTDElementNameParticle } from "./dtd/DTDElementNameParticle.js";
export { DTDGrammar } from "./dtd/DTDGrammar.js";
export { DTDName } from "./dtd/dtdName.js";
export { DTDPCData } from "./dtd/dtdPCData.js";
export { DTDSequenceModel } from "./dtd/DTDSequenceModel.js";
export { DTDSequence } from "./dtd/dtdSequence.js";
export { ElementDecl } from "./dtd/ElementDecl.js";
export { EntityDecl } from "./dtd/EntityDecl.js";
export { NotationDecl } from "./dtd/NotationDecl.js";
export { ContentParticleType } from "./dtd/contentParticle.js";
export type { ContentParticle } from "./dtd/contentParticle.js";

// Grammar classes
export { AttributeInfo, AttributeUse, GrammarType, ValidationContext, ValidationError, ValidationResult, ValidationWarning } from "./grammar/Grammar.js";
export type { Grammar } from "./grammar/Grammar.js";
export { GrammarCache } from "./grammar/GrammarCache.js";
export { RelaxNGGrammar } from "./grammar/RelaxNGGrammar.js";

// XML Schema classes
export { SchemaAll } from "./schema/SchemaAll.js";
export { SchemaAttributeDecl } from "./schema/SchemaAttributeDecl.js";
export { SchemaBuilder } from "./schema/SchemaBuilder.js";
export { SchemaChoice } from "./schema/SchemaChoice.js";
export { SchemaContentModel, SchemaContentModelType } from "./schema/SchemaContentModel.js";
export { SchemaElementDecl } from "./schema/SchemaElementDecl.js";
export { SchemaElementParticle } from "./schema/SchemaElementParticle.js";
export { SchemaGrammar } from "./schema/SchemaGrammar.js";
export { SchemaParticle } from "./schema/SchemaParticle.js";
export { SchemaSequence } from "./schema/SchemaSequence.js";
export { SchemaTypeValidator } from "./schema/SchemaTypeValidator.js";
export type { SchemaFacets } from "./schema/SchemaTypeValidator.js";
export { SchemaWildcardParticle } from "./schema/SchemaWildcardParticle.js";
export { XSDSemanticValidator } from "./schema/XSDSemanticValidator.js";

// JSON conversion helpers
export type {
	JsonPrimitive,
	JsonValue,
	JsonElementObject,
	JsonProcessingInstruction,
	JsonElementContentNode,
	JsonElementContentTextNode,
	JsonElementContentCDataNode,
	JsonElementContentCommentNode,
	JsonElementContentProcessingInstructionNode,
	JsonElementContentElementNode,
	JsonConversionMode,
	XmlDocumentToJsonOptions,
	XmlDocumentToJsonSimpleOptions,
	XmlDocumentToJsonRoundTripOptions,
	XmlToJsonOptions,
	XmlToJsonSimpleOptions,
	XmlToJsonRoundTripOptions,
	XmlFileToJsonOptions,
	XmlFileToJsonSimpleOptions,
	XmlFileToJsonRoundTripOptions,
	XmlStreamToJsonOptions,
	XmlStreamToJsonSimpleOptions,
	XmlStreamToJsonRoundTripOptions,
	XmlJsonDeclaration,
	XmlJsonDoctype,
	JsonCommentNode,
	JsonProcessingInstructionNode,
	JsonMiscNode,
	JsonTextNode,
	JsonPrologNode,
	XmlJsonDocument
} from "./json/JsonConversion.js";
export {
	xmlStringToJsonObject,
	xmlFileToJsonObject,
	xmlStreamToJsonObject,
	xmlDocumentToJsonObject,
	xmlStringToJsonFile,
	xmlFileToJsonFile,
	xmlStreamToJsonFile,
	xmlDocumentToJsonFile,
	jsonObjectToXmlDocument,
	jsonStringToXmlDocument,
	jsonFileToXmlDocument,
	jsonStreamToXmlDocument,
	jsonObjectToXmlFile,
	jsonStringToXmlFile,
	jsonFileToXmlFile,
	jsonStreamToXmlFile
} from "./json/JsonConversion.js";