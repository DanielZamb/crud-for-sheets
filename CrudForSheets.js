/**
 * db class for Google Apps Script
 * Provides methods for Create, Read, Update, and Delete operations on Google Sheets
 */

class DB {
  /**
   * @param {string} dbName - The name of the Google Spreadsheet to create and operate on.
   * @param {string} dbId - The id of the Google Spreadsheet if already created.
   */
  constructor(dbName, dbId = null) {
    try {
      let ssId;
      if (!dbId) {
        let ss = SpreadsheetApp.create(dbName)
        ssId = ss.getId();
      } else {
        ssId = dbId;
      }
      this.spreadsheet = SpreadsheetApp.openById(ssId);
      this.cache = CacheService.getScriptCache();
      this.tables = {};
      this.creationResult = {
        status: 200,
        message: "database initialized successfully",
      }
    } catch (err) {
      console.error(
          `Something went wrong initializing the DB: ${err.message}`,
          err.stack
      );
      this.creationResult = {
        status: 500,
        error: err.message,
      };
    }
  }

  getCreationResult() {
    return this.creationResult;
  }

  /**
   * Creates a new table in the spreadsheet with an optional history table.
   * @param {Object} config - Configuration for creating the table.
   * @param {string} config.tableName - Name of the main table.
   * @param {string} [config.historyTableName] - Name of the history table.
   * @param {Object<columnName, type>} config.fields - Fields of the table.
   */
  createTable(config) {
    try {
      const { tableName, historyTableName, fields } = config;

      let mainTable = this.spreadsheet.getSheetByName(tableName);
      if (!mainTable) {
        mainTable = this.spreadsheet.insertSheet(tableName);
      }
      let historyTable;
      if (historyTableName) {
        historyTable = this.spreadsheet.getSheetByName(historyTableName);
        if (!historyTable) {
          historyTable = this.spreadsheet.insertSheet(historyTableName);
        }
      } else {
        historyTable = this.spreadsheet.getSheetByName(`DELETED_${tableName}`);
        if (!historyTable)
          historyTable = this.spreadsheet.insertSheet(`DELETED_${tableName}`);
      }

      const headers = [
        "ID",
        "DATE",
        ...Object.keys(fields).map((field) => field.toUpperCase()),
      ];

      mainTable.getRange(1, 1, 1, headers.length).setValues([headers]);
      historyTable.getRange(1, 1, 1, headers.length).setValues([headers]);

      this.tables[tableName] = fields;
      return {
        status: 200,
        message: "table created successfully",
      };
    } catch (err) {
      console.error(`Error when trying to init the database: ${err.message}`);
      return {
        status: 500,
        error: err.message,
      };
    }
  }


  putTableIntoDbContext(config) {
    const { tableName, historyTableName, fields } = config;

    if (this.tables[tableName]) {
      console.error(
          `Error when trying to put table in context of the database: ${err.message}`
      );
      return {
        status: 500,
        error: err.message,
      };
    } else {
      this.tables[tableName] = fields;
      return {
        status: 200,
        message: "Table added to the schema",
      };
    }
  }

  /**
   * Create a new record in the specified table or update an existing one based on addUpdatePolicy
   * @param {string} tableName - Name of the sheet/table
   * @param {Object} data - Data to be inserted or updated
   * @param {string[]} keyOrder - Order of keys to be inserted
   * @param {Object} [addUpdatePolicy] - Policy for updating existing records
   * @param {string} addUpdatePolicy.key - The key to search for existing records
   * @param {*} addUpdatePolicy.value - The value to match for the key
   * @returns {Object} Status and ID of the created or updated record
   */

  create(tableName, data, keyOrder, addUpdatePolicy = null) {
    try {
      const sheet = this._getSheet(tableName);
      if (!sheet) {
        throw new Error(`Table "${tableName}" not found.`);
      }
      // if (!this._validateData(data, keyOrder)) {
      //   throw new Error("Invalid data format");
      // }
      const validation = this._validateData(
          data,
          keyOrder,
          `in table "${tableName}"`
      );
      if (!validation.isValid) {
        throw new Error(
            `Missing required fields: ${validation.missingKeys.join(
                ", "
            )} in table "${tableName}"`
        );
      }

      let typesChecked = false;
      if (this.tables[tableName]) {
        for (const [key, val] of Object.entries(data)) {
          const expectedType = this.tables[tableName][key];
          if (expectedType && !this._checkType(val, expectedType)) {
            throw new Error(
                `Type mismatch for field '${key}'. Expected ${expectedType}, got ${typeof val}`
            );
          }
        }
        typesChecked = true;
      }

      let existingRowIndex = -1;
      let id;

      if (addUpdatePolicy && addUpdatePolicy.key in data) {
        console.log(
            "data has matched on the additional update policy:  " +
            data[addUpdatePolicy.key]
        );
        const columnIndex = keyOrder.indexOf(addUpdatePolicy.key) + 3; // +3 for id, date, and 1-based index
        if (columnIndex > 2) {
          const column = sheet.getRange(2, columnIndex, sheet.getLastRow() - 1);
          const searchResult = column
              .createTextFinder(addUpdatePolicy.value.toString())
              .matchEntireCell(true)
              .findNext();

          if (searchResult) {
            existingRowIndex = searchResult.getRow();
            id = sheet.getRange(existingRowIndex, 1).getValue();
          }
        }
      }

      const now = new Date();

      if (existingRowIndex > -1) {
        // Update existing Record
        const updateResult = this.update(
            tableName,
            id,
            data,
            keyOrder,
            typesChecked
        );
        updateResult.action = "updated";
        return updateResult;
      } else {
        const id = this._getNextId(sheet);
        const row = [
          id,
          now,
          ...keyOrder.map((key) => {
            const value = data[key];
            if (value === undefined) return "";
            if (
                this.tables[tableName] &&
                this.tables[tableName][key] === "boolean"
            )
              return value.toString();
            return value;
          }),
        ];
        sheet.appendRow(row);

        this._clearCache(tableName);
        return {
          status: 200,
          id: id,
          action: "created",
        };
      }
    } catch (err) {
      console.error(`Error in create: ${err.message}`);
      return {
        status: 500,
        error: err.message,
      };
    }
  }
  /**
   * Update a record in the specified table
   * @param {string} tableName - Name of the sheet/table
   * @param {number} id - ID of the record to update
   * @param {Object} data - New data for the record
   * @param {string[]} keyOrder - Order of keys to be updated
   * @param typesChecked - Flag indicating if the types of the data are already checked
   * @param addUpdatePolicy
   * @returns {Object} Status and updated data
   */
  update(
      tableName,
      id,
      data,
      keyOrder,
      typesChecked = false,
      addUpdatePolicy = null
  ) {
    try {
      const sheet = this._getSheet(tableName);
      if (!sheet) throw new Error(`Table ${tableName} not found`);

      let rowIndex = this._findRowById(sheet, id);
      if (rowIndex === -1) throw new Error(`Record with ID ${id} not found`);

      // if (!this._validateData(data, keyOrder)) {
      //   throw new Error("Invalid data format");
      // }

      const validation = this._validateData(
          data,
          keyOrder,
          `in table "${tableName}"`
      );
      if (!validation.isValid) {
        throw new Error(
            `Missing required fields: ${validation.missingKeys.join(
                ", "
            )} in table "${tableName}"`
        );
      }

      if (!typesChecked) {
        if (this.tables[tableName]) {
          for (const [key, val] of Object.entries(data)) {
            const expectedType = this.tables[tableName][key];
            if (expectedType && !this._checkType(val, expectedType)) {
              throw new Error(
                  `Type mismatch for field '${key}'. Expected ${expectedType}, got ${typeof val}, value: ${val}`
              );
            }
          }
        }
      }

      if (addUpdatePolicy && addUpdatePolicy.key in data) {
        console.log(
            "data has matched on the additional update policy:  " +
            data[addUpdatePolicy.key]
        );
        const columnIndex = keyOrder.indexOf(addUpdatePolicy.key) + 3; // +3 for id, date, and 1-based index
        if (columnIndex > 2) {
          const column = sheet.getRange(2, columnIndex, sheet.getLastRow() - 1);
          const searchResult = column
              .createTextFinder(addUpdatePolicy.value.toString())
              .matchEntireCell(true)
              .findNext();

          if (searchResult) {
            rowIndex = searchResult.getRow();
            id = sheet.getRange(rowIndex, 1).getValue();
          }
        }
      }

      const now = new Date();
      const updatedRow = [
        id,
        now,
        ...keyOrder.map((key) => {
          const value = data[key];
          if (value === undefined) return "";
          if (
              this.tables[tableName] &&
              this.tables[tableName][key] === "boolean"
          )
            return value.toString();
          return value;
        }),
      ];
      sheet.getRange(rowIndex, 1, 1, updatedRow.length).setValues([updatedRow]);

      this._clearCache(tableName);
      return {
        status: 200,
        id: id,
        data: data,
        action: "updated",
      };
    } catch (err) {
      console.error(`Error in update: ${err.message}`);
      return {
        status: 500,
        error: err.message,
      };
    }
  }
  /**
   * Read a record from the specified table
   * @param {string} tableName - Name of the sheet/table
   * @param {number} id - ID of the record to read
   * @returns {Object} Status and data of the read record
   */
  read(tableName, id) {
    try {
      const sheet = this._getSheet(tableName);
      if (!sheet) throw new Error(`Table "${tableName}" not found`);

      const rowIndex = this._findRowById(sheet, id);
      if (rowIndex === -1) throw new Error(`Record with ID ${id} not found`);

      const row = sheet
          .getRange(rowIndex, 1, 1, sheet.getLastColumn())
          .getValues()[0];

      const headers = this._getHeaders(sheet);

      const record = headers.reduce((acc, header, index) => {
        acc[header] = row[index];
        return acc;
      }, {});

      return {
        status: 200,
        data: record,
      };
    } catch (err) {
      console.error(`Error in read: ${err.message}`);
      return {
        status: 500,
        error: err.message,
      };
    }
  }

  /**
   * Delete a record from the specified table
   * @param {string} tableName - Name of the sheet/table
   * @param {string} historyTableName - Name of the history sheet/table
   * @param {number} id - ID of the record to delete
   * @returns {Object} Status of the operation
   */
  remove(tableName, historyTableName, id) {
    try {
      const sheet = this._getSheet(tableName);
      const historySheet = this._getSheet(historyTableName);
      if (!sheet) throw new Error(`Table "${tableName}" not found`);
      if (!historySheet)
        throw new Error(`History Table "${tableName}" not found`);

      const rowIndex = this._findRowById(sheet, id);
      if (rowIndex === -1) throw new Error(`Record with ID ${id} not found`);

      const deletedRow = sheet
          .getRange(rowIndex, 1, 1, sheet.getLastColumn())
          .getValues()[0];
      sheet.deleteRow(rowIndex);

      const historyId = this._getNextId(historySheet);
      historySheet.appendRow([historyId, new Date(), ...deletedRow.slice(2)]);

      this._clearCache(tableName);
      this._clearCache(historyTableName);

      return {
        status: 200,
        message: "Record removed succesfully",
      };
    } catch (err) {
      console.error(`Error in remove: ${err.message}`);
      return {
        status: 500,
        error: err.message,
      };
    }
  }

  /**
   * Get all records from the specified table
   * @param {string} tableName - Name of the sheet/table
   * @param {Object} options - Options for pagination and sorting
   * @param useCache - Flag that tells the db to use cached records
   * @returns {Object} Status and array of records
   */
  getAll(tableName, options = {}, useCache = true) {
    try {
      let message = "Data retrieved successfully";
      const sheet = this._getSheet(tableName);
      if (!sheet) throw new Error(`Table "${tableName}" not found`);

      const cacheKey = `${tableName}_all`;
      let data;

      if (useCache) {
        data = this._getCachedData(cacheKey);
      }

      if (!data) {
        const headers = this._getHeaders(sheet);

        if (sheet.getLastRow() === 1) {
          return {
            status: 200,
            data: [],
            message: `No data in the table "${tableName}"`,
          };
        }

        data = sheet
            .getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
            .getValues()
            .map((row) =>
                headers.reduce((acc, header, index) => {
                  header = header.toLowerCase();
                  acc[header] = row[index];
                  return acc;
                }, {})
            );
        if (!(data.length > 1000)) {
          this._setCachedData(cacheKey, data);
        }
      }

      if (options.sortBy) {
        const sortField = options.sortBy;
        const sortOrder = options.sortOrder === "desc" ? -1 : 1;
        const fieldType = this.tables[tableName][sortField];
        console.log("fieldTypes", this.tables[tableName]);
        if (fieldType) {
          data.sort((a, b) => {
            // console.log(a);
            let compareOperator;
            switch (fieldType) {
              case "number":
                compareOperator = a[sortField] - b[sortField];
                break;
              case "string":
                compareOperator = a[sortField].localeCompare(b[sortField]);
                break;
              case "boolean":
                if (a[sortField] && !b[sortField]) {
                  compareOperator = -1;
                } else if (!a[sortField] && b[sortField]) {
                  compareOperator = 1;
                } else {
                  compareOperator = 0;
                }
                break;
              case "date":
                compareOperator =
                    a[sortField].getTime() - b[sortField].getTime();
                break;
              default:
                throw new Error(`Unsupported sort field type: ${fieldType}`);
            }
            return compareOperator * sortOrder;
          });
          message = `Data sorted Succesfully by '${sortField}'`;
        } else {
          message = `Warning: Sorting not applied. Field '${sortField}' not found in table schema.`;
        }
      }

      if (options.page && options.pageSize) {
        const page = parseInt(options.page);
        const pageSize = parseInt(options.pageSize);
        if (isNaN(page) || isNaN(pageSize) || page < 1 || pageSize < 1) {
          throw new Error("Invalid pagination parameters");
        }
        const startIndex = (page - 1) * pageSize;
        data = data.slice(startIndex, startIndex + pageSize);
        message += ` (Page ${page}, ${pageSize} items per page)`;
      }

      return {
        status: 200,
        data: data,
        message: message,
      };
    } catch (err) {
      console.error(`Error in getAll: ${err.message}`);
      return {
        status: 500,
        error: err.message,
      };
    }
  }

  getRelatedRecordsWithFilter(
      foreignKey,
      tableName,
      field,
      fieldIndex,
      options = {},
      useCache = false
  ) {
    try {
      let message = "Related Data retrieved successfully";
      const sheet = this._getSheet(tableName);

      if (!(typeof foreignKey === "number"))
        throw new Error(`Foreign key (${foreignKey}) is not a number!`);

      if (!sheet) {
        throw new Error(`Table "${tableName}" not found`)
      } else {
        console.log(`Table found: ${sheet.getName()}`);
      }

      if (!this.tables[tableName][field]){
        throw new Error(`Query field (${field}) does NOT exists in the table.`);
      }

      const cacheKey = `${tableName}_FK_${foreignKey}_all`;
      let relatedData;

      if (useCache) {
        relatedData = this._getCachedData(cacheKey).filter((record) => {
          return record[field] === foreignKey;
        });
      }

      if (!relatedData) {
        const headers = this._getHeaders(sheet);

        if (sheet.getLastRow() === 1) {
          return {
            status: 200,
            data: [],
            message: `No Data in the Table "${tableName}"`,
          };
        }
        console.log("queried column: ", headers[fieldIndex])
        relatedData = sheet
            .getRange(2, 1, sheet.getLastRow(), sheet.getLastColumn())
            .getValues()
            .filter((row) => {
              // console.log("row analizada")
              return row[fieldIndex] === foreignKey;
            })
            .map((row) => {
              return headers.reduce((acc, header, index) => {
                header = header.toLowerCase();
                acc[header] = row[index];
                return acc;
              }, {});
            });
        if (relatedData.length <= 1000) {
          this._setCachedData(cacheKey, relatedData);
        }
      }

      if (options.sortBy) {
        const sortField = options.sortBy;
        const sortOrder = options.sortOrder === "desc" ? -1 : 1;
        const fieldType = this.tables[tableName][sortField];
        console.log("fieldTypes", this.tables[tableName]);

        if (fieldType) {
          relatedData.sort((a, b) => {
            let compareOperator;

            switch (fieldType) {
              case "number":
                compareOperator = a[sortField] - b[sortField];
                break;
              case "string":
                compareOperator = a[sortField].localeCompare(b[sortField]);
                break;
              case "boolean":
                if (a[sortField] && !b[sortField]) {
                  compareOperator = -1;
                } else if (!a[sortField] && b[sortField]) {
                  compareOperator = 1;
                } else {
                  compareOperator = 0;
                }
                break;
              case "date":
                compareOperator =
                    a[sortField].getTime() - b[sortField].getTime();
                break;
              default:
                throw new Error(`Unsupported sort field type: ${fieldType}`);
            }

            return compareOperator * sortOrder;
          });
          message = `Related Data Sorted Successfully by '${sortField}'`;
        } else {
          message = `Warning: Sorting not applied. Field '${sortField}' not found in table schema.`;
        }
      }

      if (options.page && options.pageSize) {
        const page = parseInt(options.page);
        const pageSize = parseInt(options.pageSize);
        if (isNaN(page) || isNaN(pageSize) || page < 1 || pageSize < 1) {
          throw new Error("Invalid pagination parameters");
        }

        const startIndex = (page - 1) * pageSize;
        relatedData = relatedData.slice(startIndex, startIndex + pageSize);
        message += `(Page ${page}, ${pageSize} items per page)`;
      }

      return {
        status: 200,
        data: relatedData,
        message: message,
      };
    } catch (err) {
      console.error(`Error in fetchRelatedRecords: ${err.message}`);
      return {
        status: 500,
        error: err.message,
      };
    }
  }

  getRelatedRecords(
      foreignKey,
      tableName,
      field,
      fieldIndex,
      options = {},
      useCache = false
  ) {
    try {
      let message = "Related Data retrieved successfully";
      const sheet = this._getSheet(tableName);

      if (!(typeof foreignKey === "number"))
        throw new Error(`Foreign key (${foreignKey}) is not a number!`);

      if (!sheet) {
        throw new Error(`Table "${tableName}" not found`)
      } else {
        console.log(`Table found: ${sheet.getName()}`);
      }

      if (!this.tables[tableName][field]){
        throw new Error(`Query field (${field}) does NOT exists in the table.`);
      }

      const cacheKey = `${tableName}_FK_${foreignKey}_all`;
      let relatedData;

      if (useCache) {
        relatedData = this._getCachedData(cacheKey).filter((record) => {
          return record[field] === foreignKey;
        });
      }

      if (!relatedData) {
        const headers = this._getHeaders(sheet);

        if (sheet.getLastRow() === 1) {
          return {
            status: 200,
            data: [],
            message: `No Data in the Table "${tableName}"`,
          };
        }
        console.log("queried column: ", headers[fieldIndex])
        relatedData = sheet
            .getRange(2, 1, sheet.getLastRow(), sheet.getLastColumn())
            .getValues()
        let finalData = [];
        for (let i=0;i<relatedData.length; i++){
          let row = relatedData[i];
          let obj = {}
          if (row[fieldIndex] === foreignKey){
            // console.log("row que si paso", row)
            for (let j=0; j<headers.length; j++){
              let header = headers[j].toLowerCase();
              obj[header] = row[j];
            }
            finalData.push(obj)
          }
        }
        relatedData = finalData;
        if (relatedData.length <= 1000) {
          this._setCachedData(cacheKey, relatedData);
        }
      }

      if (options.sortBy) {
        const sortField = options.sortBy;
        const sortOrder = options.sortOrder === "desc" ? -1 : 1;
        const fieldType = this.tables[tableName][sortField];
        console.log("fieldTypes", this.tables[tableName]);

        if (fieldType) {
          relatedData.sort((a, b) => {
            let compareOperator;

            switch (fieldType) {
              case "number":
                compareOperator = a[sortField] - b[sortField];
                break;
              case "string":
                compareOperator = a[sortField].localeCompare(b[sortField]);
                break;
              case "boolean":
                if (a[sortField] && !b[sortField]) {
                  compareOperator = -1;
                } else if (!a[sortField] && b[sortField]) {
                  compareOperator = 1;
                } else {
                  compareOperator = 0;
                }
                break;
              case "date":
                compareOperator =
                    a[sortField].getTime() - b[sortField].getTime();
                break;
              default:
                throw new Error(`Unsupported sort field type: ${fieldType}`);
            }

            return compareOperator * sortOrder;
          });
          message = `Related Data Sorted Successfully by '${sortField}'`;
        } else {
          message = `Warning: Sorting not applied. Field '${sortField}' not found in table schema.`;
        }
      }

      if (options.page && options.pageSize) {
        const page = parseInt(options.page);
        const pageSize = parseInt(options.pageSize);
        if (isNaN(page) || isNaN(pageSize) || page < 1 || pageSize < 1) {
          throw new Error("Invalid pagination parameters");
        }

        const startIndex = (page - 1) * pageSize;
        relatedData = relatedData.slice(startIndex, startIndex + pageSize);
        message += `(Page ${page}, ${pageSize} items per page)`;
      }

      return {
        status: 200,
        data: relatedData,
        message: message,
      };
    } catch (err) {
      console.error(`Error in fetchRelatedRecords: ${err.message}`);
      return {
        status: 500,
        error: err.message,
      };
    }
  }

  getRelatedRecordsWithTextFinder(
      foreignKey,
      tableName,
      field,
      fieldIndex,
      options = {},
      useCache = false
  ) {
    try {
      let message = "Related Data retrieved successfully";
      const sheet = this._getSheet(tableName);

      if (!(typeof foreignKey === "number"))
        throw new Error(`Foreign key (${foreignKey}) is not a number!`);

      if (!sheet) throw new Error(`Table "${tableName}" not found`);

      const cacheKey = `${tableName}_FK_${foreignKey}_all`;
      let relatedData;

      if (useCache) {
        relatedData = this._getCachedData(cacheKey).filter((record) => {
          return record[field] === foreignKey;
        });
      }

      if (!relatedData) {
        const headers = this._getHeaders(sheet);
        const lastRow = sheet.getLastRow();
        const lastColumn = sheet.getLastColumn();
        relatedData = [];
        if (sheet.getLastRow() === 1) {
          return {
            status: 200,
            data: [],
            message: `No Data in the Table "${tableName}"`,
          };
        }

        const dataRange = sheet.getRange(2, 1, lastRow - 1, lastColumn);
        const allData = dataRange.getValues();

        const searchColumnRange = sheet.getRange(2, fieldIndex + 1, lastRow - 1, 1);
        const textFinder = searchColumnRange.createTextFinder(foreignKey.toString())
            .matchEntireCell(true)
            .matchCase(false);
        const matchedRanges = textFinder.findAll();

        if (matchedRanges.length === 0) {
          return {
            status: 200,
            data: [],
            message: `No related records found for foreign key ${foreignKey}`,
          };
        }

        const rowIndicesSet = new Set();
        matchedRanges.forEach((range) => {
          rowIndicesSet.add(range.getRow());
        });
        // console.log("set of indices",rowIndicesSet)
        const rowIndices = Array.from(rowIndicesSet).sort((a, b) => a - b);
        // console.log("array of indices ordered",rowIndices)

        // const rowIndices = matchedRanges.map((range) => range.getRow()).sort((a, b) => a - b);
        const filteredRows = rowIndices.map((row) => allData[row - 2]);

        relatedData = filteredRows.map((row) => {
          headers.reduce((acc, header, index) => {
            header = header.toLowerCase();
            acc[header] = row[index];
            return acc;
          }, {});
        });


        if (relatedData.length <= 1000) {
          this._setCachedData(cacheKey, relatedData);
        }
      }

      if (options.sortBy) {
        const sortField = options.sortBy;
        const sortOrder = options.sortOrder === "desc" ? -1 : 1;
        const fieldType = this.tables[tableName][sortField];
        console.log("fieldTypes", this.tables[tableName]);

        if (fieldType) {
          relatedData.sort((a, b) => {
            let compareOperator;

            switch (fieldType) {
              case "number":
                compareOperator = a[sortField] - b[sortField];
                break;
              case "string":
                compareOperator = a[sortField].localeCompare(b[sortField]);
                break;
              case "boolean":
                if (a[sortField] && !b[sortField]) {
                  compareOperator = -1;
                } else if (!a[sortField] && b[sortField]) {
                  compareOperator = 1;
                } else {
                  compareOperator = 0;
                }
                break;
              case "date":
                compareOperator =
                    a[sortField].getTime() - b[sortField].getTime();
                break;
              default:
                throw new Error(`Unsupported sort field type: ${fieldType}`);
            }

            return compareOperator * sortOrder;
          });
          message = `Related Data Sorted Successfully by '${sortField}'`;
        } else {
          message = `Warning: Sorting not applied. Field '${sortField}' not found in table schema.`;
        }
      }

      if (options.page && options.pageSize) {
        const page = parseInt(options.page);
        const pageSize = parseInt(options.pageSize);
        if (isNaN(page) || isNaN(pageSize) || page < 1 || pageSize < 1) {
          throw new Error("Invalid pagination parameters");
        }

        const startIndex = (page - 1) * pageSize;
        relatedData = relatedData.slice(startIndex, startIndex + pageSize);
        message += `(Page ${page}, ${pageSize} items per page)`;
      }

      return {
        status: 200,
        data: relatedData,
        message: message,
      };
    } catch (err) {
      console.error(`Error in fetchRelatedRecords: ${err.message}`);
      return {
        status: 500,
        error: err.message,
      };
    }
  }

  _getHeaders(sheet) {
    return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  }

  _getSheet(name) {
    return this.spreadsheet.getSheetByName(name);
  }

  _getNextId(sheet) {
    const lastRow = sheet.getLastRow();
    console.log(lastRow);
    if (lastRow <= 1) return 1;

    const idRange = sheet.getRange("A:A");
    const lastId = idRange.getValues()[lastRow - 1][0];

    const nextId = Math.max(lastRow, parseInt(lastId) + 1);
    return nextId;
  }

  _getCachedData(key) {
    const cached = this.cache.get(key);
    return cached ? JSON.parse(cached) : null;
  }

  _setCachedData(key, data) {
    this.cache.put(key, JSON.stringify(data), 600);
  }

  _clearCache(tableName) {
    this.cache.remove(`${tableName}_all`);
  }

  /**
   * Find the row index of a record by its ID
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - The sheet to search in
   * @param {number|string} id - The ID to search for
   * @returns {number} The row index of the found ID, or -1 if not found
   */
  _findRowById(sheet, id) {
    const idRange = sheet.getRange("A:A");
    const searchResult = idRange
        .createTextFinder(id.toString())
        .matchEntireCell(true)
        .matchCase(false)
        .findNext();
    return searchResult ? searchResult.getRow() : -1;
  }

  // _validateData(data, keyOrder) {
  //   return keyOrder.every((key) => key in data);
  // }

  /**
   * Validates that all required keys are present in the data object.
   * @param {Object} data - The data object to validate.
   * @param {string[]} keyOrder - An array of required keys.
   * @param {string} [context] - Optional context for error messages.
   * @returns {Object} - An object containing validation status and missing keys.
   */
  _validateData(data, keyOrder, context = "") {
    const missingKeys = keyOrder.filter((key) => !(key in data));
    const isValid = missingKeys.length === 0;
    return { isValid, missingKeys, context };
  }

  _checkType(value, expectedType) {
    switch (expectedType) {
      case "number":
        return typeof value === "number" && !isNaN(value);
      case "string":
        return typeof value === "string";
      case "boolean":
        return typeof value === "boolean";
      case "date":
        // console.log("chequeo de tipo date", value instanceof Date)
        console.log(
            "chequeo de que getTime() es un numero",
            !isNaN(value.getTime())
        );
        console.log(
            "chequeo de que es tipo date por otro metodo",
            Object.prototype.toString.call(value) === "[object Date]"
        );
        return (
            Object.prototype.toString.call(value) === "[object Date]" &&
            !isNaN(value.getTime())
        );
      default:
        return false;
    }
  }
  applyColorScheme(tableName, colorScheme) {
    const sheet = this.spreadsheet.getSheetByName(tableName);
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();

    // Define multiple color schemes
    const colorSchemes = {
      red: {
        headerColor: "#E53935", // Red header
        color1: "#FFCDD2", // Light Red for alternating rows
        color2: "#FFEBEE", // Lighter Red
      },
      blue: {
        headerColor: "#1E88E5", // Blue header
        color1: "#BBDEFB", // Light Blue for alternating rows
        color2: "#E3F2FD", // Lighter Blue
      },
      green: {
        headerColor: "#43A047", // Green header
        color1: "#C8E6C9", // Light Green for alternating rows
        color2: "#E8F5E9", // Lighter Green
      },
      orange: {
        headerColor: "#FB8C00", // Orange header
        color1: "#FFE0B2", // Light Orange for alternating rows
        color2: "#FFF3E0", // Lighter Orange
      },
      purple: {
        headerColor: "#8E24AA", // Purple header
        color1: "#E1BEE7", // Light Purple for alternating rows
        color2: "#F3E5F5", // Lighter Purple
      },
    };

    // Get the chosen color scheme based on the input
    const scheme = colorSchemes[colorScheme];

    if (!scheme) {
      throw new Error(
          "Color scheme not found. Available schemes: red, blue, green, orange, purple."
      );
    }

    // Apply color to the header row
    const headerRange = sheet.getRange(1, 1, 1, lastCol);
    headerRange.setBackground(scheme.headerColor).setFontColor("#FFFFFF");

    // Apply alternating colors to the data rows
    for (let row = 2; row <= lastRow; row++) {
      const range = sheet.getRange(row, 1, 1, lastCol);
      if (row % 2 === 0) {
        range.setBackground(scheme.color2); // Even rows
      } else {
        range.setBackground(scheme.color1); // Odd rows
      }
    }
  }

}

/**
 * Creates and returns a new instance of the CRUD class
 * @returns {DB} A new instance of the CRUD class
 * @param dbName - Name of the Database
 * @param dbId - id of the sheet if already created
 */
function init(dbName, dbId = "") {
  return new DB(dbName, dbId);
}

function example() {
  const db = new DB(
      "myTestDataBase",
      (dbId = "1auvs768mjQQS9dTJuutCOpYKvWTSUjtPmzzZCSZBM1M")
  );

  console.log(db.getCreationResult());

  const employeeTableConfig = {
    tableName: "EMPLOYEES",
    fields: {
      name: "string",
      age: "number",
      position: "string",
      employed: "boolean",
      hire_date: "date",
    },
  };

  db.createTable(employeeTableConfig);

  console.log("employee table created");

  const employees = [
    {
      name: "John Doe",
      age: 30,
      position: "Software Engineer",
      employed: true,
      hire_date: new Date("2022-01-15"),
    },
    {
      name: "Jane Smith",
      age: 28,
      position: "Product Manager",
      employed: true,
      hire_date: new Date("2021-11-05"),
    },
    {
      name: "Mike Johnson",
      age: 35,
      position: "Data Scientist",
      employed: true,
      hire_date: new Date("2020-08-20"),
    },
    {
      name: "Emily Davis",
      age: 24,
      position: "UX Designer",
      employed: false,
      hire_date: new Date("2019-02-01"),
    },
    {
      name: "Chris Lee",
      age: 40,
      position: "Operations Manager",
      employed: true,
      hire_date: new Date("2020-12-10"),
    },
    {
      name: "Sarah Wilson",
      age: 33,
      position: "HR Specialist",
      employed: true,
      hire_date: new Date("2018-06-18"),
    },
    {
      name: "Alex Martin",
      age: 29,
      position: "Business Analyst",
      employed: false,
      hire_date: new Date("2021-04-25"),
    },
    {
      name: "Linda Clark",
      age: 42,
      position: "Accountant",
      employed: true,
      hire_date: new Date("2021-09-30"),
    },
    {
      name: "James Walker",
      age: 27,
      position: "DevOps Engineer",
      employed: true,
      hire_date: new Date("2017-07-19"),
    },
    {
      name: "Jessica Brown",
      age: 26,
      position: "Marketing Manager",
      employed: false,
      hire_date: new Date("2022-03-22"),
    },
    {
      name: "Robert Harris",
      age: 37,
      position: "Network Engineer",
      employed: true,
      hire_date: new Date("2021-01-11"),
    },
    {
      name: "Sophia Lewis",
      age: 31,
      position: "Backend Developer",
      employed: true,
      hire_date: new Date("2020-05-15"),
    },
    {
      name: "Lucas Moore",
      age: 34,
      position: "Frontend Developer",
      employed: false,
      hire_date: new Date("2022-02-17"),
    },
    {
      name: "Olivia Taylor",
      age: 25,
      position: 'QA Engineer',
      employed: true,
      hire_date: new Date("2020-10-27"),
    },
    {
      name: "Daniel Anderson",
      age: 38,
      position: "System Administrator",
      employed: true,
      hire_date: new Date("2019-11-09"),
    },
  ];
  // let results = []
  // for (e of employees) {
  //   results.push(db.create('EMPLOYEES', e, ['name', 'age', 'position', 'employed', 'hire_date']));
  // }
  db.create(
      "EMPLOYEES",
      {
        name: "hola",
        age: 25,
        position: "QA Engineer",
        employed: "true",
        hire_date: new Date("2020-10-27"),
      },
      ["name", "age", "position", "employed", "hire_date"]
  );
  // console.log('Create Result: ', results);

  // Read an employee by ID
  // const readResult = db.read('EMPLOYEES', createResult.id);
  // console.log('Read Result:', readResult.data);

  // Update the employee record
  // const updatedEmployee = {
  //   name: 'John Doe',
  //   age: 31, // Updated age
  //   position: 'Senior Software Engineer', // Updated position
  // };
  // const updateResult = db.update('EMPLOYEES', createResult.id, updatedEmployee, ['name', 'age', 'position']);
  // console.log('Update Result:', updateResult);

  // Delete the employee record
  // const deleteResult = db.remove('EMPLOYEES', 'DELETED_EMPLOYEES', createResult.id);
  // console.log('Delete Result:', deleteResult);
  // Get All with pagination and sorting
  const getAllResult = db.getAll(
      "EMPLOYEES",
      { page: 1, pageSize: 25, sortBy: "hire_date", sortOrder: "desc" },
      (useCache = false)
  );
  console.log(getAllResult);

  // getAllResult.data.map((row) => {
  //    console.log(row)
  //    for (const [key, val] of Object.entries(row)) {
  //       console.log(`type of ${key}: `, typeof(val))
  //       if (key === "DATE"){
  //         console.log("fecha es un tipo Date",val instanceof Date);
  //         console.log("getime en la fecha:", val.getTime());
  //       }
  //     }
  // })
}
