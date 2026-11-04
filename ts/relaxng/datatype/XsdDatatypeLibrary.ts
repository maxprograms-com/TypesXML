/*******************************************************************************
 * Copyright (c) 2023-2026 Maxprograms.
 *
 * This program and the accompanying materials
 * are made available under the terms of the Eclipse Public License 1.0
 * which accompanies this distribution, and is available at
 * https://www.eclipse.org/org/documents/epl-v10.html
 *
 * Contributors:
 *     Maxprograms - initial API and implementation
 *******************************************************************************/

import { SchemaFacets, SchemaTypeValidator } from '../../schema/SchemaTypeValidator.js';
import { Datatype } from './Datatype.js';
import { DatatypeBuilder } from './DatatypeBuilder.js';
import { DatatypeException } from './DatatypeException.js';
import { DatatypeLibrary } from './DatatypeLibrary.js';
import { ValidationContext } from './ValidationContext.js';
import { XsdDatatype } from './XsdDatatype.js';

export const XSD_DATATYPE_LIBRARY: string = 'http://www.w3.org/2001/XMLSchema-datatypes';

const XSD_TYPES: Set<string> = new Set<string>([
    'string', 'normalizedString', 'token', 'language', 'Name', 'NCName', 'ID', 'IDREF', 'IDREFS',
    'ENTITY', 'ENTITIES', 'NMTOKEN', 'NMTOKENS', 'boolean', 'decimal', 'float', 'double',
    'integer', 'long', 'int', 'short', 'byte', 'unsignedLong', 'unsignedInt', 'unsignedShort',
    'unsignedByte', 'nonNegativeInteger', 'positiveInteger', 'nonPositiveInteger', 'negativeInteger',
    'anyURI', 'QName', 'NOTATION', 'base64Binary', 'hexBinary', 'dateTime', 'date', 'time',
    'duration', 'gYear', 'gYearMonth', 'gMonth', 'gMonthDay', 'gDay', 'anySimpleType'
]);

const LIST_TYPES: Set<string> = new Set<string>(['IDREFS', 'ENTITIES', 'NMTOKENS']);

class XsdDatatypeBuilder implements DatatypeBuilder {

    private readonly facets: SchemaFacets;
    private readonly used: Set<string> = new Set<string>();

    constructor(private readonly typeName: string) {
        this.facets = { whiteSpace: SchemaTypeValidator.getBuiltInWhiteSpace(typeName) };
        if (LIST_TYPES.has(typeName)) {
            this.facets.isList = true;
        }
    }

    addParameter(name: string, strValue: string, _context: ValidationContext | null): void {
        if (name !== 'pattern') {
            if (this.used.has(name)) {
                throw new DatatypeException('Parameter "' + name + '" is specified more than once');
            }
            this.used.add(name);
            strValue = strValue.replaceAll(/[\t\n\r ]+/g, ' ').trim();
        }
        const toNumber = (): number => {
            const parsed: number = Number(strValue.trim());
            if (!Number.isInteger(parsed) || parsed < 0) {
                throw new DatatypeException('Invalid value "' + strValue + '" for datatype parameter "' + name + '"');
            }
            return parsed;
        };
        switch (name) {
            case 'length':
                this.facets.length = toNumber();
                break;
            case 'minLength':
                this.facets.minLength = toNumber();
                break;
            case 'maxLength':
                this.facets.maxLength = toNumber();
                break;
            case 'totalDigits':
                this.facets.totalDigits = toNumber();
                break;
            case 'fractionDigits':
                this.facets.fractionDigits = toNumber();
                break;
            case 'minInclusive':
                this.facets.minInclusive = strValue.trim();
                break;
            case 'maxInclusive':
                this.facets.maxInclusive = strValue.trim();
                break;
            case 'minExclusive':
                this.facets.minExclusive = strValue.trim();
                break;
            case 'maxExclusive':
                this.facets.maxExclusive = strValue.trim();
                break;
            case 'pattern':
                // each pattern parameter must match, so each one is its own group
                if (!this.facets.patterns) {
                    this.facets.patterns = [];
                }
                this.facets.patterns.push([strValue]);
                break;
            default:
                throw new DatatypeException('Unsupported parameter "' + name + '" for datatype "' + this.typeName + '"');
        }
    }

    createDatatype(): Datatype {
        const facets: SchemaFacets = this.facets;
        if (facets.length !== undefined) {
            if (facets.minLength !== undefined && facets.minLength > facets.length) {
                throw new DatatypeException('minLength "' + facets.minLength + '" is greater than length "' + facets.length + '"');
            }
            if (facets.maxLength !== undefined && facets.maxLength < facets.length) {
                throw new DatatypeException('maxLength "' + facets.maxLength + '" is less than length "' + facets.length + '"');
            }
        }
        if (facets.minLength !== undefined && facets.maxLength !== undefined && facets.minLength > facets.maxLength) {
            throw new DatatypeException('minLength "' + facets.minLength + '" is greater than maxLength "' + facets.maxLength + '"');
        }
        if (facets.fractionDigits !== undefined && facets.totalDigits !== undefined && facets.fractionDigits > facets.totalDigits) {
            throw new DatatypeException('fractionDigits "' + facets.fractionDigits + '" is greater than totalDigits "' + facets.totalDigits + '"');
        }
        return new XsdDatatype(this.typeName, { ...this.facets });
    }
}

export class XsdDatatypeLibrary implements DatatypeLibrary {

    createDatatypeBuilder(baseTypeLocalName: string): DatatypeBuilder {
        if (!XSD_TYPES.has(baseTypeLocalName)) {
            throw new DatatypeException('Unknown XML Schema datatype "' + baseTypeLocalName + '"');
        }
        return new XsdDatatypeBuilder(baseTypeLocalName);
    }

    createDatatype(typeLocalName: string): Datatype {
        return this.createDatatypeBuilder(typeLocalName).createDatatype();
    }
}
