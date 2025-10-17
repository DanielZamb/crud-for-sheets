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
        let ss = SpreadsheetApp.create(dbName);
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
      };
      //script lock
      this.lockService = LockService.getScriptLock();
      //userlock
      this.userLockService = LockService.getUserLock();
      this.lockTimeout = 100;
      this.readLockTimeout = 30000;
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

  _acquireLock(tableName, recordId, lockType) {
    try {
      // create the lock key
      // const lockKey = `${tableName}_${recordId}_${lockType}`;
      console.log(
        `[LOCK] Attempting to acquire ${lockType} lock for record ${recordId} in table ${tableName}`
      );

      let lock = false;

      if (lockType === "write") {
        lock = this.lockService.tryLock(this.lockTimeout);
      } else if (lockType === "read") {
        lock = this.lockService.tryLock(this.readLockTimeout);
      }

      if (lock) {
        console.log(
          `[LOCK] Acquired ${lockType} lock for record ${recordId} in table ${tableName}`
        );
        return true;
      } else {
        console.warn(
          `[LOCK] Failed to acquire ${lockType} lock for record ${recordId} in table ${tableName}`
        );
        return false;
      }
    } catch (err) {
      console.error(`[LOCK] Error acquiring lock: ${err.stack}`);
      return false;
    }
  }

  _releaseLock(tableName, recordId, lockType) {
    try {
      // const lockKey = `${tableName}_${recordId}_${lockType}`;
      Utilities.sleep(400);
      this.lockService.releaseLock();
      console.log(
        `[LOCK] Released ${lockType} lock for record ${recordId} in table ${tableName}`
      );
    } catch (err) {
      console.error(`[LOCK] Error releasing lock: ${err.stack}`);
    }
  }

  releaseLocks() {
    try {
      this.lockService.releaseLock();
      console.log("[LOCK] Released all locks");
    } catch (err) {
      console.error(`[LOCK] Error in releaseLocks: ${err.stack}`);
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

      this.tables[tableName] = this._normalizeSchemaFields(fields);
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

  /**
   * Creates configuration for a many-to-many junction table
   * @param {Object} config Configuration object
   * @param {string} config.tableName Name of the junction table
   * @param {string} config.historyTableName Name of the history table
   * @param {string} config.entity1TableName Name of the first entity table
   * @param {string} config.entity2TableName Name of the second entity table
   * @param {Object} [config.fieldsRelatedToBothEntities] Additional fields that describe the relationship
   * @returns {Object} Table configuration object
   */
  createManyToManyTableConfig(config) {
    try {
      const {
        entity1TableName,
        entity2TableName,
        fieldsRelatedToBothEntities,
      } = config;

      if (!entity1TableName || !entity2TableName) {
        throw new Error(
          "Required fields missing: tableName, entity1TableName, and entity2TableName are required"
        );
      }

      //check if the 2 entities are in schema context
      if (!this.tables[entity1TableName] || !this.tables[entity2TableName]) {
        throw new Error(
          `Tables must be in schema context before creating relation. ` +
            `${entity1TableName} exists: ${!!this.tables[entity1TableName]}, ` +
            `${entity2TableName} exists: ${!!this.tables[entity2TableName]}`
        );
      }

      //check if the parent tables actually exist as sheets
      const entity1Sheet = this._getSheet(entity1TableName);
      const entity2Sheet = this._getSheet(entity2TableName);
      if (!entity1Sheet || !entity2Sheet) {
        throw new Error(
          `Parent tables must exist as sheets before creating junction table. ` +
            `${entity1TableName} sheet exists: ${!!entity1Sheet}, ` +
            `${entity2TableName} sheet exists: ${!!entity2Sheet}`
        );
      }

      this._checkValidCreationTypes(fieldsRelatedToBothEntities);

      return {
        status: 200,
        data: {
          tableName: `${entity1TableName}_${entity2TableName}_RELATION`,
          historyTableName: `DELETED_${entity1TableName}_${entity2TableName}_RELATION`,
          fields: {
            created_at: "date",
            [`${entity1TableName.toLocaleLowerCase()}_id`]: "number",
            [`${entity2TableName.toLocaleLowerCase()}_id`]: "number",
            ...fieldsRelatedToBothEntities,
          },
        },
        message: `config object for Junction table ${entity1TableName}_${entity2TableName}_RELATION, dont forget to put the tableConfig into schema context`,
      };
    } catch (err) {
      console.error(`Error in createManyToManyTableConfig: ${err.stack}`);
      return {
        status: 500,
        error: {
          message: err.message,
          stackTrace: err.stack,
        },
      };
    }
  }

  /**
   * Adds a table to the database context
   * @param {Object} config - Table configuration object
   * @param {string} config.tableName - Name of the table
   * @param {Object} config.fields - Field definitions for the table
   * @returns {Object} Status of the operation
   */
  putTableIntoDbContext(config) {
    const { tableName, historyTableName, fields } = config;

    if (this.tables[tableName]) {
      console.error(
        `Error when trying to put table in context of the database: Already in context`
      );
      return {
        status: 500,
        error:
          "Error when trying to put table in context of the database: Already in context",
      };
    } else {
      this.tables[tableName] = this._normalizeSchemaFields(fields);
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
      // Apply defaults before validation and type checking
      const defaultsApplication = this._applyDefaults(
        tableName,
        data,
        keyOrder
      );
      const dataWithDefaults = defaultsApplication.data;
      if (defaultsApplication.appliedDefaults.length > 0) {
        console.warn("[DEFAULTS] Applied during create:", {
          tableName,
          applied: defaultsApplication.appliedDefaults,
        });
      }

      const validation = this._validateData(
        tableName,
        dataWithDefaults,
        keyOrder,
        `for table "${tableName}"`
      );
      if (!validation.isValid) {
        throw new Error(
          `Missing required fields: ${validation.missingKeys.join(
            ", "
          )} for table "${tableName}"`
        );
      }

      let typesChecked = false;
      if (this.tables[tableName]) {
        for (const [key, val] of Object.entries(dataWithDefaults)) {
          const expectedType = this._getExpectedType(tableName, key);
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

      if (addUpdatePolicy && addUpdatePolicy.key in dataWithDefaults) {
        console.log(
          "data has matched on the additional update policy:  " +
            dataWithDefaults[addUpdatePolicy.key]
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
        //acquiring lock!!
        if (!this._acquireLock(tableName, id, "write")) {
          throw new Error("Could not acquire lock for update operation");
        }
        try {
          const updateResult = this.update(
            tableName,
            id,
            dataWithDefaults,
            keyOrder,
            typesChecked
          );
          updateResult.action = "updated";
          return updateResult;
        } finally {
          this._releaseLock(tableName, id, "write");
        }
      } else {
        const id = this._getNextId(sheet);
        const row = [
          id,
          now,
          ...keyOrder.map((key) => {
            const value = dataWithDefaults[key];
            if (value === undefined) return "";
            const expectedType = this._getExpectedType(tableName, key);
            if (expectedType === "boolean") return value.toString();
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
        status:
          err.message.includes(`Type mismatch`) ||
          err.message.includes(`Missing required fields`) ||
          err.message.includes(`Incomplete keyOrder`)
            ? 400
            : 500,
        error: err.message,
      };
    }
  }

  /**
   * Creates a record in a junction table for many-to-many relationships
   * @param {string} junctionTableName - Name of the junction table
   * @param {Object} data - Data containing the foreign keys and additional fields
   * @param {string[]} keyOrder - Order of keys to be inserted
   * @returns {Object} Status and ID of the created junction record
   */
  createJunctionRecord(junctionTableName, data, keyOrder) {
    try {
      // Validate required parameters
      if (!data || Object.keys(data).length === 0) {
        throw new Error("Data parameter is required for createJunctionRecord");
      }

      const table = this._getSheet(junctionTableName);
      if (!table) {
        throw new Error(`Junction table '${junctionTableName}' not found`);
      }

      const headers = this._getHeaders(table);
      if (!headers || !headers.length) {
        throw new Error(
          `Could not retrieve headers for table '${junctionTableName}'`
        );
      }

      // Validate we have exactly two foreign keys
      const checkDimension =
        Object.keys(data).filter((key) => key.includes("_id")).length === 2;
      if (!checkDimension) {
        throw new Error(
          `Junction table must have exactly two foreign key fields, got ${
            Object.keys(data).filter((key) => key.includes("_id")).length
          } for table ${junctionTableName} , keys received: ${Object.keys(
            data
          ).join(", ")}`
        );
      }

      // Get foreign key field names and their indices
      let entityTableNames = keyOrder.filter((item) => item.endsWith("_id"));
      console.log("entity table names no cleaning:", entityTableNames);

      const entityFkIndices = entityTableNames.map((fieldName) =>
        headers.indexOf(fieldName.toUpperCase())
      );
      console.log("fk column indices:", entityFkIndices);

      // Validate all foreign key columns were found
      if (entityFkIndices.includes(-1)) {
        throw new Error("One or more foreign key columns not found in headers");
      }

      // Clean table names by removing _id suffix
      entityTableNames = entityTableNames.map((item) =>
        item.replace(/_id$/, "")
      );
      console.log("entity table names:", entityTableNames);

      // Collect and validate foreign keys
      const fksIds = [];
      for (const tableName of entityTableNames) {
        const id_field = `${tableName}_id`;
        const recordId = data[id_field];
        fksIds.push(recordId);

        const response = this.read(tableName.toUpperCase(), recordId);
        if (response.status === 500) {
          throw new Error(
            `Record with ID ${recordId} not found in table ${tableName}. read() error: ${response.error}`
          );
        }
      }

      // Get all existing foreign key combinations
      const lastRow = table.getLastRow() === 1 ? 2 : table.getLastRow();
      const existingRecords = [];
      entityFkIndices.forEach((colIndex) =>
        existingRecords.push(
          table.getRange(2, colIndex + 1, lastRow - 1).getValues()
        )
      );

      // console.log("existing records:", existingRecords)
      // console.log("existing records length:", existingRecords[0].length)
      // console.log("fks length:", fksIds.length)
      // console.log("existing records first element:", existingRecords[0][0][0])
      let isDuplicate = false;

      for (let i = 0; i < existingRecords[0].length && !isDuplicate; i++) {
        let isMatch = true;
        for (let j = 0; j < existingRecords.length && isMatch; j++) {
          if (existingRecords[j][i][0] !== fksIds[j]) {
            isMatch = false;
          }
        }
        if (isMatch) {
          isDuplicate = true;
        }
      }

      if (isDuplicate) {
        throw new Error(
          `Duplicate relationship found for keys: ${fksIds.join(", ")}`
        );
      }
      // Prepare final data with timestamp
      const enrichedData = {
        created_at: new Date(),
        ...data,
      };

      return this.create(junctionTableName, enrichedData, keyOrder);
    } catch (err) {
      console.error("Error in createJunctionRecord:", err.stack);
      const isValidationError =
        err.message.includes("Data parameter is required") ||
        err.message.includes("must have exactly two") ||
        err.message.includes("not found in headers") ||
        err.message.includes("Type mismatch") ||
        err.message.includes("Missing required fields") ||
        err.message.includes("Incomplete keyOrder");
      return {
        status: isValidationError ? 400 : 500,
        error: {
          message: err.message,
          stackTrace: err.stack,
        },
      };
    }
  }

  /**
   * Gets records from a junction table along with related data
   * @param {string} junctionTableName - Name of the junction table
   * @param {string} sourceTableName - Name of the source table
   * @param {string} targetTableName - Name of the target table
   * @param {number} sourceId - ID from the source table
   * @param {Object} options - Options for pagination and sorting
   * @returns {Object} Status and array of related records with their relationships
   */
  getJunctionRecords(
    junctionTableName,
    sourceTableName,
    targetTableName,
    sourceId,
    options
  ) {
    try {
      console.log("[JUNCTION] Starting junction record retrieval:", {
        junctionTable: junctionTableName,
        sourceTable: sourceTableName,
        targetTable: targetTableName,
        sourceId,
        options,
      });
      const foreignKeyField = `${sourceTableName.toLowerCase()}_id`;
      const targetKeyField = `${targetTableName.toLowerCase()}_id`;
      const fieldIndex = this._getFieldIndex(
        junctionTableName,
        foreignKeyField
      );

      if (fieldIndex === -1) {
        throw new Error(
          `Foreign key field '${foreignKeyField}' not found in junction table`
        );
      }

      const junctionResult = this.getRelatedRecords(
        sourceId,
        junctionTableName,
        foreignKeyField,
        fieldIndex,
        options
      );

      if (junctionResult.status !== 200) {
        return junctionResult;
      }

      if (junctionResult.data.length === 0) {
        return {
          status: 200,
          data: [],
          message: `No relations found for ${sourceTableName} ID ${sourceId}`,
        };
      }

      const targetsIds = [];

      for (let i = 0; i < junctionResult.data.length; i++) {
        targetsIds.push(junctionResult.data[i][targetKeyField]);
      }
      console.log("[JUNCTION] Found target IDs:", targetsIds);

      const targetRecords = this.readIdList(targetTableName, targetsIds);

      if (targetRecords.status !== 200) {
        return targetRecords;
      }

      const combinedData = [];

      const targetMap = new Map(
        targetRecords.data.map((record) => [record.id, record])
      );

      for (let i = 0; i < junctionResult.data.length; i++) {
        const targetRecord = targetMap.get(
          junctionResult.data[i][targetKeyField]
        );
        if (targetRecord) {
          combinedData.push({
            ...targetRecord,
            relationship: junctionResult.data[i],
          });
        }
      }

      return {
        status: 200,
        data: combinedData,
        message: `Retrieved ${combinedData.length} related records from ${targetTableName}`,
        metadata: {
          totalJunctionRecords: junctionResult.data.length,
          totalTargetRecords: targetRecords.data.length,
          missingTargets: targetsIds.length - combinedData.length,
        },
      };
    } catch (err) {
      console.error(`Error in getJunctionRecords: ${err.stack}`);
      return {
        status: 500,
        error: {
          message: err.message,
          stackTrace: err.stack,
        },
      };
    }
  }

  createWithLogs(tableName, data, keyOrder, addUpdatePolicy = null) {
    try {
      console.log("\n[CREATE] Starting create operation:", {
        tableName,
        data,
        keyOrder,
        addUpdatePolicy,
      });

      // Get sheet and validate existence
      const sheet = this._getSheet(tableName);
      console.log("[SHEET] Retrieved sheet:", sheet ? sheet.getName() : "null");
      if (!sheet) {
        throw new Error(`Table "${tableName}" not found.`);
      }

      // Apply defaults then validate
      const defaultsApplication = this._applyDefaults(
        tableName,
        data,
        keyOrder
      );
      const dataWithDefaults = defaultsApplication.data;
      if (defaultsApplication.appliedDefaults.length > 0) {
        console.warn("[DEFAULTS] Applied during createWithLogs:", {
          tableName,
          applied: defaultsApplication.appliedDefaults,
        });
      }

      console.log("[VALIDATION] Starting data validation");
      const validation = this._validateData(
        tableName,
        dataWithDefaults,
        keyOrder,
        `for table "${tableName}"`
      );
      console.log("[VALIDATION] Result:", validation);
      if (!validation.isValid) {
        throw new Error(
          `Missing required fields: ${validation.missingKeys.join(
            ", "
          )} for table "${tableName}"`
        );
      }

      // Type checking
      let typesChecked = false;
      if (this.tables[tableName]) {
        console.log(
          "[TYPES] Starting type validation for fields:",
          this.tables[tableName]
        );
        for (const [key, val] of Object.entries(dataWithDefaults)) {
          const expectedType = this._getExpectedType(tableName, key);
          console.log("[TYPES] Checking field:", {
            key,
            value: val,
            expectedType,
            actualType: typeof val,
          });

          if (expectedType && !this._checkType(val, expectedType)) {
            throw new Error(
              `Type mismatch for field '${key}'. Expected ${expectedType}, got ${typeof val}`
            );
          }
        }
        typesChecked = true;
        console.log("[TYPES] All type checks passed");
      } else {
        console.log(
          "[TYPES] No type definitions found for table, skipping type checks"
        );
      }

      // Check for existing record
      let existingRowIndex = -1;
      let id;

      if (addUpdatePolicy && addUpdatePolicy.key in dataWithDefaults) {
        console.log(
          "[UPDATE POLICY] Checking for existing record with policy:",
          {
            key: addUpdatePolicy.key,
            value: addUpdatePolicy.value,
            matchValue: dataWithDefaults[addUpdatePolicy.key],
          }
        );

        const columnIndex = keyOrder.indexOf(addUpdatePolicy.key) + 3; // +3 for id, date, and 1-based index
        console.log("[UPDATE POLICY] Calculated column index:", columnIndex);

        if (columnIndex > 2) {
          const column = sheet.getRange(2, columnIndex, sheet.getLastRow() - 1);
          console.log("[UPDATE POLICY] Searching in range:", {
            startRow: 2,
            column: columnIndex,
            numRows: sheet.getLastRow() - 1,
          });

          const searchResult = column
            .createTextFinder(addUpdatePolicy.value.toString())
            .matchEntireCell(true)
            .findNext();

          if (searchResult) {
            existingRowIndex = searchResult.getRow();
            id = sheet.getRange(existingRowIndex, 1).getValue();
            console.log("[UPDATE POLICY] Found existing record:", {
              row: existingRowIndex,
              id: id,
            });
          } else {
            console.log("[UPDATE POLICY] No existing record found");
          }
        }
      }

      const now = new Date();
      console.log("[TIMESTAMP] Using timestamp:", now);

      if (existingRowIndex > -1) {
        // Update existing Record
        console.log("[UPDATE] Updating existing record:", {
          tableName,
          id,
          existingRowIndex,
        });

        const updateResult = this.update(
          tableName,
          id,
          dataWithDefaults,
          keyOrder,
          typesChecked
        );
        updateResult.action = "updated";
        console.log("[UPDATE] Update complete:", updateResult);
        return updateResult;
      } else {
        // Create new record
        console.log("[CREATE] Creating new record");
        const id = this._getNextId(sheet);
        console.log("[CREATE] Generated new ID:", id);

        const row = [
          id,
          now,
          ...keyOrder.map((key) => {
            const value = dataWithDefaults[key];
            console.log("[CREATE] Processing field:", {
              key,
              value,
              type: typeof value,
              isUndefined: value === undefined,
              isBoolean: this._getExpectedType(tableName, key) === "boolean",
            });

            if (value === undefined) return "";
            if (this._getExpectedType(tableName, key) === "boolean")
              return value.toString();
            return value;
          }),
        ];

        console.log("[CREATE] Final row data to append:", row);
        sheet.appendRow(row);

        const dataView = sheet
          .getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
          .getValues()
          .slice(10);
        console.log("[CREATE CHECK] Final sheet data ", dataView);

        console.log("[CACHE] Clearing cache for table:", tableName);
        this._clearCache(tableName);

        const result = {
          status: 200,
          id: id,
          action: "created",
        };
        console.log("[CREATE] Operation complete:", result);
        return result;
      }
    } catch (err) {
      console.error("[ERROR] Error in create operation:", {
        error: err.message,
        stack: err.stack,
        tableName,
        data,
      });
      return {
        status:
          err.message.includes(`Type mismatch`) ||
          err.message.includes(`Missing required fields`) ||
          err.message.includes(`Incomplete keyOrder`)
            ? 400
            : 500,
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
      if (!this._acquireLock(tableName, id, "write")) {
        throw new Error("Could not acquire write lock");
      }
      try {
        const sheet = this._getSheet(tableName);
        if (!sheet) throw new Error(`Table ${tableName} not found`);

        let rowIndex = this._findRowById(sheet, id);
        if (rowIndex === -1) throw new Error(`Record with ID ${id} not found`);

        // Apply defaults before validation
        const defaultsApplication = this._applyDefaults(
          tableName,
          data,
          keyOrder
        );
        const dataWithDefaults = defaultsApplication.data;
        if (defaultsApplication.appliedDefaults.length > 0) {
          console.warn("[DEFAULTS] Applied during update:", {
            tableName,
            id,
            applied: defaultsApplication.appliedDefaults,
          });
        }

        const validation = this._validateData(
          tableName,
          dataWithDefaults,
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
            for (const [key, val] of Object.entries(dataWithDefaults)) {
              const expectedType = this._getExpectedType(tableName, key);
              if (expectedType && !this._checkType(val, expectedType)) {
                throw new Error(
                  `Type mismatch for field '${key}'. Expected ${expectedType}, got ${typeof val}, value: ${val}`
                );
              }
            }
          }
        }

        if (addUpdatePolicy && addUpdatePolicy.key in dataWithDefaults) {
          console.log(
            "data has matched on the additional update policy:  " +
              dataWithDefaults[addUpdatePolicy.key]
          );
          const columnIndex = keyOrder.indexOf(addUpdatePolicy.key) + 3; // +3 for id, date, and 1-based index
          if (columnIndex > 2) {
            const column = sheet.getRange(
              2,
              columnIndex,
              sheet.getLastRow() - 1
            );
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
            const value = dataWithDefaults[key];
            if (value === undefined) return "";
            const expectedType = this._getExpectedType(tableName, key);
            if (expectedType === "boolean") return value.toString();
            return value;
          }),
        ];
        sheet
          .getRange(rowIndex, 1, 1, updatedRow.length)
          .setValues([updatedRow]);

        this._clearCache(tableName);
        console.log(updatedRow);
        return {
          status: 200,
          id: id,
          data: { id: id, date: now, ...dataWithDefaults }, // includes defaults used
          action: "updated",
        };
      } finally {
        this._releaseLock(tableName, id, "write");
      }
    } catch (err) {
      console.error(`Error in update: ${err.message}`);
      return {
        status: err.message.includes(`Record with ID`)
          ? 404
          : err.message.includes(`Type mismatch`) ||
            err.message.includes(`Missing required fields`) ||
            err.message.includes(`Incomplete keyOrder`)
          ? 400
          : 500,
        error: err.message,
      };
    }
  }

  updateWithLogs(
    tableName,
    id,
    data,
    keyOrder,
    typesChecked = false,
    addUpdatePolicy = null
  ) {
    try {
      console.log("Update Method Input:", {
        tableName,
        id,
        data,
        keyOrder,
        typesChecked,
        addUpdatePolicy,
      });

      const sheet = this._getSheet(tableName);
      if (!sheet) throw new Error(`Table "${tableName}" not found`);

      let rowIndex = this._findRowById(sheet, id);
      console.log("Found row index:", rowIndex);
      if (rowIndex === -1) throw new Error(`Record with ID ${id} not found`);

      // Apply defaults and validate
      const defaultsApplicationUW = this._applyDefaults(
        tableName,
        data,
        keyOrder
      );
      const dataWithDefaultsUW = defaultsApplicationUW.data;
      if (defaultsApplicationUW.appliedDefaults.length > 0) {
        console.warn("[DEFAULTS] Applied during updateWithLogs:", {
          tableName,
          id,
          applied: defaultsApplicationUW.appliedDefaults,
        });
      }
      const validation = this._validateData(
        tableName,
        dataWithDefaultsUW,
        keyOrder,
        `in table "${tableName}"`
      );
      console.log("Validation result:", validation);

      if (!validation.isValid) {
        throw new Error(
          `Missing required fields: ${validation.missingKeys.join(
            ", "
          )} in table "${tableName}"`
        );
      }

      // Type checking
      if (!typesChecked && this.tables[tableName]) {
        console.log(
          "Performing type checks for fields:",
          this.tables[tableName]
        );
        for (const [key, val] of Object.entries(dataWithDefaultsUW)) {
          const expectedType = this._getExpectedType(tableName, key);
          console.log("Checking type for field:", {
            key,
            value: val,
            expectedType,
            actualType: typeof val,
          });

          if (expectedType && !this._checkTypeWithLogs(val, expectedType)) {
            throw new Error(
              `Type mismatch for field '${key}'. Expected ${expectedType}, got ${typeof val}, value: ${val}`
            );
          }
        }
      }

      // Build updated row data
      const now = new Date();
      const updatedRow = [id, now];

      console.log("Building row data with keyOrder:", keyOrder);

      keyOrder.forEach((key) => {
        const value = dataWithDefaultsUW[key];
        console.log("Processing field:", {
          key,
          value,
          type: typeof value,
          fieldType: this._getExpectedType(tableName, key),
        });

        if (value === undefined) {
          updatedRow.push("");
        } else if (this._getExpectedType(tableName, key) === "boolean") {
          updatedRow.push(Boolean(value).toString());
        } else if (value === null) {
          updatedRow.push("");
        } else {
          updatedRow.push(value);
        }
      });

      console.log("Final row data to write:", updatedRow);

      // Update the sheet
      const range = sheet.getRange(rowIndex, 1, 1, updatedRow.length);
      console.log("Updating range:", {
        row: rowIndex,
        columns: updatedRow.length,
        values: updatedRow,
      });

      range.setValues([updatedRow]);

      this._clearCache(tableName);

      return {
        status: 200,
        id: id,
        data: dataWithDefaultsUW,
        action: "updated",
      };
    } catch (err) {
      console.error("Update error details:", {
        error: err.message,
        stack: err.stack,
      });
      return {
        status: err.message.includes(`Record with ID`)
          ? 404
          : err.message.includes(`Type mismatch`) ||
            err.message.includes(`Missing required fields`) ||
            err.message.includes(`Incomplete keyOrder`)
          ? 400
          : 500,
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
      if (!this._acquireLock(tableName, id, "read")) {
        throw new Error("Could not acquire read lock");
      }

      try {
        const sheet = this._getSheet(tableName);
        if (!sheet) throw new Error(`Table "${tableName}" not found`);

        const rowIndex = this._findRowById(sheet, id);
        if (rowIndex === -1) throw new Error(`Record with ID ${id} not found`);

        const row = sheet
          .getRange(rowIndex, 1, 1, sheet.getLastColumn())
          .getValues()[0];

        let headers_caps = this._getHeaders(sheet);

        const headers = [];
        headers_caps.forEach((s) => headers.push(s.toLowerCase()));

        const record = headers.reduce((acc, header, index) => {
          acc[header] = row[index];
          return acc;
        }, {});

        return {
          status: 200,
          data: record,
        };
      } finally {
        this._releaseLock(tableName, id, "read");
      }
    } catch (err) {
      console.error(`Error in read: ${err.message}`);
      return {
        status: err.message.includes(`Record with ID`) ? 404 : 500,
        error: err.message,
      };
    }
  }

  /**
   * Reads a list of records by their IDs
   * @param {string} tableName - Name of the table to read from
   * @param {number[]} ids - Array of record IDs to retrieve
   * @returns {Object} Status and array of found records, with list of any IDs not found
   */
  readIdList(tableName, ids) {
    try {
      console.log("[READ LIST] Starting batch read operation:", {
        tableName,
        numberOfIds: ids.length,
        ids,
      });

      const MAX_IDS = 1000;
      if (ids.length > MAX_IDS) {
        return {
          status: 400,
          error: {
            message: `Cannot request more than ${MAX_IDS} records at once, try getAll()`,
          },
        };
      }
      if (!Array.isArray(ids) || ids.length === 0) {
        return {
          status: 400,
          error: {
            message: "IDs must be a non-empty array",
          },
        };
      }
      if (!ids.every((id) => typeof id === "number")) {
        return {
          status: 400,
          error: {
            message: "All IDs must be numbers",
          },
        };
      }

      const table = this._getSheet(tableName);
      if (!table) throw new Error(`Table "${tableName}" not found`);

      const headers = this._getHeaders(table);
      console.log("[READ LIST] Retrieved headers:", headers);

      const idsSet = new Set(ids);
      const idsFound = new Map(ids.map((id) => [id, false]));
      const data = table
        .getRange(2, 1, table.getLastRow() - 1, table.getLastColumn())
        .getValues();

      const records = [];

      for (let i = 0; i < data.length; i++) {
        if (idsSet.has(data[i][0])) {
          const record = headers.reduce((acc, header, index) => {
            acc[header.toLowerCase()] = data[i][index];
            return acc;
          }, {});
          records.push(record);
          idsFound.set(data[i][0], true);
        }
      }

      const notFoundIds = Array.from(idsFound.entries())
        .filter(([_, found]) => !found)
        .map(([id, _]) => id);

      console.log("[READ LIST] Retrieved records:", {
        found: records.length,
        notFound: notFoundIds,
      });

      return {
        status: 200,
        data: records,
        notFound: notFoundIds,
        message:
          notFoundIds.size > 0
            ? `Retrieved ${
                records.length
              } records. IDs not found: ${notFoundIds.join(", ")}`
            : `Retrieved ${records.length} records successfully`,
      };
    } catch (err) {
      console.error("[READ LIST] Error: ", err.stack);
      return {
        status: 500,
        error: {
          message: err.message,
          stackTrace: err.stack,
        },
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
      if (!this._acquireLock(tableName, id, "write")) {
        throw new Error("Could not acquire write lock");
      }
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
      } finally {
        this._releaseLock(tableName, id, "write");
      }
    } catch (err) {
      console.error(`Error in remove: ${err.message}`);
      return {
        status: err.message.includes(`Record with ID`) ? 404 : 500,
        error: err.message,
      };
    }
  }

  /**
   * Removes a record and its related junction records
   * @param {string} tableName - Name of the table
   * @param {string} historyTableName - Name of the history table
   * @param {number} id - ID of the record to remove
   * @returns {Object} Status of the cascade delete operation
   */
  removeWithCascade(tableName, historyTableName, id) {
    try {
      const sheet = this._getSheet(tableName);
      const historySheet = this._getSheet(historyTableName);
      if (!tableName) throw new Error(`Table name is required`); //see if this breaks the test suite
      if (!historyTableName) throw new Error(`History table name is required`); //see if this breaks the test suite
      if (!id) throw new Error(`ID is required`); //see if this breaks the test suite
      if (!sheet) throw new Error(`Table "${tableName}" not found`);
      if (!historySheet)
        throw new Error(`History Table "${historyTableName}" not found`);

      const rowIndex = this._findRowById(sheet, id);
      if (rowIndex === -1) throw new Error(`Record with ID ${id} not found`);

      this._handleCascadeDelete(tableName, id); // aca no se si esto debe ser un response o un try catch

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
      console.error(`Error in remove: ${err.stack}`);
      return {
        status: err.message.includes(`Record with ID`) ? 404 : 500,
        error: {
          message: err.message,
          stackTrace: err.stack,
        },
      };
    }
  }

  /**
   * Validates the integrity of a junction table
   * @param {string} junctionTableName - Name of the junction table to check
   * @param {string} junctionHistoryTableName - Name of the history table
   * @returns {Object} Status and count of invalid records removed
   */
  checkTableIntegrity(junctionTableName, junctionHistoryTableName) {
    try {
      const table = this._getSheet(junctionTableName);
      const historyTable = this._getSheet(junctionHistoryTableName);

      if (!table || !historyTable) {
        console.error("[SHEETS] Sheet reference check failed:", {
          mainTableExists: !!table,
          historyTableExists: !!historyTable,
        });
        throw new Error(
          !table
            ? `Table '${tableName}' not found when trying to delete related junction records`
            : `Table '${junctionHistoryTableName}' not found when trying to delete related junction records`
        );
      }

      const headers = this._getHeaders(table);
      const fkColumns = headers.filter((h) => h.toLowerCase().endsWith("_id"));

      if (fkColumns.length !== 2) {
        throw new Error("Invalid junction table structure");
      }

      if (table.getLastRow() === 1)
        return {
          status: 204,
          message: "No records to check integrity of.",
          count: 0,
        };

      const data = table
        .getRange(2, 1, table.getLastRow() - 1, table.getLastColumn())
        .getValues();
      const invalidRows = [];
      const rowsToRemove = [];

      const historyId = this._getNextId(historyTable);

      for (let i = 0; i < data.length; i++) {
        let isValid = true;
        for (let j = 0; j < fkColumns.length; j++) {
          const colIndex = headers.indexOf(fkColumns[j]);
          const fkValue = data[i][colIndex];
          const parentTable = fkColumns[j].replace(/_id$/i, "").toUpperCase();

          const response = this.read(parentTable, fkValue);
          if (response.status !== 200) {
            isValid = false;
          }
        }
        if (!isValid) {
          invalidRows.unshift(i + 2);
          rowsToRemove.push([
            historyId + invalidRows.length,
            new Date(),
            ...data[i].slice(2),
          ]);
        }
      }

      if (invalidRows.length > 0) {
        console.log("[DELETE] Starting row deletion process");
        invalidRows.forEach((rowIdx, index) => {
          console.log(
            `[DELETE] Removing row ${rowIdx} (${index + 1}/${
              invalidRows.length
            })`
          );
          table.deleteRow(rowIdx);
        });
        console.log("[DELETE] Row deletion completed");

        // Add to history
        console.log("[HISTORY] Adding records to history table");
        const historyRange = historyTable.getRange(
          historyTable.getLastRow() == 1 ? 2 : historyTable.getLastRow(),
          1,
          rowsToRemove.length,
          rowsToRemove[0].length
        );
        historyRange.setValues(rowsToRemove);
        console.log("[HISTORY] History records added successfully");

        // Clear cache
        console.log("[CACHE] Clearing cache for affected tables");
        this._clearCache(junctionTableName);
        this._clearCache(junctionHistoryTableName);
        console.log("[CACHE] Cache cleared successfully");
      } else {
        console.log("[NO_ACTION] No matching records found to delete");
      }

      const result = {
        status: 200,
        count: rowsToRemove.length,
        message: "Record(s) removed successfully",
      };
      console.log("[COMPLETE] Operation finished successfully:", result);
      return result;
    } catch (err) {
      console.error(`Error in checkTableIntegrity: ${err.stack}`);
      return {
        status: 500,
        error: {
          message: err.message,
          stackTrace: err.stack,
        },
      };
    }
  }

  /**
   * Deletes related records from a junction table
   * @param {string} tableName - Name of the junction table
   * @param {string} junctionHistoryTableName - Name of the history table
   * @param {number} fkIndex - Index of the foreign key column
   * @param {number} id - ID to match in the foreign key column
   * @returns {Object} Status and count of deleted records
   */
  deleteRelatedJunctionRecords(
    tableName,
    junctionHistoryTableName,
    fkIndex,
    id
  ) {
    console.log("\n[DELETE_JUNCTION] Starting deletion process:", {
      tableName,
      historyTable: junctionHistoryTableName,
      fkIndex,
      targetId: id,
    });

    try {
      if (!this._acquireLock(tableName, id, "write")) {
        throw new Error("Could not acquire write lock");
      }
      try {
        // Get and validate table references
        console.log("[SHEETS] Attempting to get sheet references");
        const table = this._getSheet(tableName);
        const historyTable = this._getSheet(junctionHistoryTableName);

        if (!table || !historyTable) {
          console.error("[SHEETS] Sheet reference check failed:", {
            mainTableExists: !!table,
            historyTableExists: !!historyTable,
          });
          throw new Error(
            !table
              ? `Table '${tableName}' not found when trying to delete related junction records`
              : `Table '${junctionHistoryTableName}' not found when trying to delete related junction records`
          );
        }
        console.log("[SHEETS] Successfully retrieved both sheets");

        // Check for existing data
        const lastRow = table.getLastRow();
        console.log("[ROWS] Last row in table:", lastRow);

        if (lastRow < 1) {
          console.log("[EMPTY] Table is empty, no records to delete");
          return {
            status: 204,
            message: "No content to delete",
          };
        }

        // Get data range for processing
        console.log("[DATA] Retrieving data range:", {
          startRow: 2,
          targetColumn: fkIndex + 1,
          numRows: lastRow - 1,
          numCols: table.getLastColumn(),
        });

        const idCol = table.getRange(2, fkIndex + 1, lastRow - 1).getValues();
        const fullData = table
          .getRange(2, 1, lastRow - 1, table.getLastColumn())
          .getValues();
        console.log("[DATA] Retrieved rows:", idCol.length);

        // Prepare for deletion
        const historyId = this._getNextId(historyTable);
        console.log("[HISTORY] Generated new history ID:", historyId);

        // Find records to remove
        console.log("[PROCESS] Starting record identification");
        let idxToRemove = [];
        let rowsToRemove = [];

        for (let i = 0; i < idCol.length; i++) {
          if (idCol[i][0] === id) {
            idxToRemove.unshift(i + 2);
            rowsToRemove.push([
              historyId + idxToRemove.length,
              new Date(),
              ...fullData[i].slice(2),
            ]);
            console.log(
              `[MATCH] Found matching record at row ${i + 2}, ${fullData[i]}`
            );
          }
        }

        console.log("[SUMMARY] Records found:", {
          totalMatches: rowsToRemove.length,
          idxToDelete: idxToRemove,
          rowsToDelete: rowsToRemove,
          historyRecordsToCreate: rowsToRemove.length,
        });

        // Perform deletions
        if (idxToRemove.length > 0) {
          console.log("[DELETE] Starting row deletion process");
          idxToRemove.forEach((rowIdx, index) => {
            console.log(
              `[DELETE] Removing row ${rowIdx} (${index + 1}/${
                idxToRemove.length
              })`
            );
            table.deleteRow(rowIdx);
          });
          console.log("[DELETE] Row deletion completed");

          // Add to history
          console.log("[HISTORY] Adding records to history table");
          const historyRange = historyTable.getRange(
            historyTable.getLastRow() == 1 ? 2 : historyTable.getLastRow(),
            1,
            rowsToRemove.length,
            rowsToRemove[0].length
          );
          historyRange.setValues(rowsToRemove);
          console.log("[HISTORY] History records added successfully");

          // Clear cache
          console.log("[CACHE] Clearing cache for affected tables");
          this._clearCache(tableName);
          this._clearCache(junctionHistoryTableName);
          console.log("[CACHE] Cache cleared successfully");
        } else {
          console.log("[NO_ACTION] No matching records found to delete");
        }

        const result = {
          status: 200,
          count: rowsToRemove.length,
          message: "Record(s) removed successfully",
        };
        console.log("[COMPLETE] Operation finished successfully:", result);
        return result;
      } finally {
        this._releaseLock(tableName, id, "write");
      }
    } catch (err) {
      console.error("[ERROR] Failed to remove related junction records:", {
        error: err.message,
        stack: err.stack,
        context: {
          tableName,
          historyTable: junctionHistoryTableName,
          fkIndex,
          targetId: id,
        },
      });

      return {
        status: 500,
        error: {
          message: err.message,
          stackTrace: err.stack,
        },
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
        let fieldType = this.tables[tableName][sortField];
        if (fieldType && fieldType.hasOwnProperty("type"))
          fieldType = fieldType.type;
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
        throw new Error(`Table "${tableName}" not found`);
      } else {
        console.log(`Table found: ${sheet.getName()}`);
      }

      if (!this.tables[tableName][field]) {
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
        console.log("queried column: ", headers[fieldIndex]);
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
        let fieldType = this.tables[tableName][sortField];
        if (fieldType && fieldType.hasOwnProperty("type"))
          fieldType = fieldType.type;
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

  getRelatedRecordsWithLogs(
    foreignKey,
    tableName,
    field,
    fieldIndex,
    options = {},
    useCache = false
  ) {
    try {
      console.log(`[START] getRelatedRecords with params:`, {
        foreignKey,
        tableName,
        field,
        fieldIndex,
        options,
        useCache,
      });

      let message = "Related Data retrieved successfully";
      const sheet = this._getSheet(tableName);

      console.log(`[SHEET] Retrieved sheet:`, sheet ? sheet.getName() : "null");

      // Type checking for foreign key
      if (!(typeof foreignKey === "number")) {
        console.error(`[ERROR] Invalid foreign key type:`, typeof foreignKey);
        throw new Error(`Foreign key (${foreignKey}) is not a number!`);
      }

      // Sheet existence check
      if (!sheet) {
        console.error(`[ERROR] Sheet not found:`, tableName);
        throw new Error(`Table "${tableName}" not found`);
      }

      // Field existence check
      if (!this.tables[tableName][field]) {
        console.error(`[ERROR] Field not found:`, {
          table: tableName,
          field: field,
          availableFields: Object.keys(this.tables[tableName]),
        });
        throw new Error(`Query field (${field}) does NOT exists in the table.`);
      }

      const cacheKey = `${tableName}_FK_${foreignKey}_all`;
      let relatedData;

      // Cache check
      if (useCache) {
        console.log(
          `[CACHE] Attempting to retrieve from cache with key:`,
          cacheKey
        );
        relatedData = this._getCachedData(cacheKey);
        if (relatedData) {
          console.log(
            `[CACHE] Data found in cache, length:`,
            relatedData.length
          );
        } else {
          console.log(`[CACHE] No cached data found`);
        }
      }

      if (!relatedData) {
        console.log(`[PROCESS] Starting data retrieval from sheet`);
        const headers = this._getHeaders(sheet);
        console.log(`[HEADERS] Retrieved headers:`, headers);

        const lastRow = sheet.getLastRow();
        console.log(`[ROWS] Last row:`, lastRow);

        if (sheet.getLastRow() === 1) {
          console.log(`[EMPTY] Table is empty (only headers)`);
          return {
            status: 200,
            data: [],
            message: `No Data in the Table "${tableName}"`,
          };
        }

        console.log(`[DATA] Retrieving data range from sheet`);
        relatedData = sheet
          .getRange(2, 1, sheet.getLastRow(), sheet.getLastColumn())
          .getValues();
        console.log(`[DATA] Retrieved ${relatedData.length} rows of raw data`);

        let finalData = [];
        console.log(
          `[FILTER] Starting to filter data with fieldIndex:`,
          fieldIndex
        );
        console.log(`[FILTER] Looking for foreignKey:`, foreignKey);

        for (let i = 0; i < relatedData.length; i++) {
          let row = relatedData[i];
          if (i === 0 || i === relatedData.length - 1) {
            console.log(`[ROW ${i}] Sample row data:`, row);
            console.log(`[ROW ${i}] Value at fieldIndex:`, row[fieldIndex]);
          }

          if (row[fieldIndex] === foreignKey) {
            let obj = {};
            for (let j = 0; j < headers.length; j++) {
              let header = headers[j].toLowerCase();
              obj[header] = row[j];
            }
            finalData.push(obj);
          }
        }

        console.log(`[FILTER] Found ${finalData.length} matching records`);
        relatedData = finalData;

        if (relatedData.length <= 1000) {
          console.log(`[CACHE] Caching ${relatedData.length} records`);
          this._setCachedData(cacheKey, relatedData);
        } else {
          console.log(`[CACHE] Data too large to cache:`, relatedData.length);
        }
      }

      // Sorting
      if (options.sortBy) {
        console.log(`[SORT] Attempting to sort by:`, options.sortBy);
        const sortField = options.sortBy;
        const sortOrder = options.sortOrder === "desc" ? -1 : 1;
        let fieldType = this.tables[tableName][sortField];
        if (fieldType && fieldType.hasOwnProperty("type"))
          fieldType = fieldType.type;
        console.log(`[SORT] Field type:`, fieldType);

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
          console.warn(`[SORT] Field not found in schema:`, sortField);
          message = `Warning: Sorting not applied. Field '${sortField}' not found in table schema.`;
        }
      }

      // Pagination
      if (options.page && options.pageSize) {
        console.log(`[PAGE] Applying pagination:`, options);
        const page = parseInt(options.page);
        const pageSize = parseInt(options.pageSize);

        if (isNaN(page) || isNaN(pageSize) || page < 1 || pageSize < 1) {
          console.error(`[PAGE] Invalid pagination parameters:`, {
            page,
            pageSize,
          });
          throw new Error("Invalid pagination parameters");
        }

        const startIndex = (page - 1) * pageSize;
        relatedData = relatedData.slice(startIndex, startIndex + pageSize);
        message += `(Page ${page}, ${pageSize} items per page)`;
        console.log(`[PAGE] Applied pagination, results:`, relatedData.length);
      }

      console.log(`[END] Returning ${relatedData.length} records`);
      return {
        status: 200,
        data: relatedData,
        message: message,
      };
    } catch (err) {
      console.error(`[ERROR] Error in getRelatedRecords:`, err);
      console.error(`[ERROR] Stack trace:`, err.stack);
      return {
        status: 500,
        error: err.message,
      };
    }
  }

  /**
   * Gets related records when provided a fk.
   * @param {number} foreignKey - Foreign key to search for
   * @param {string} tableName - Name of the table to search in
   * @param {string} field - Field name containing the foreign key
   * @param {number} fieldIndex - Index of the field in the table
   * @param {Object} [options={}] - Options for pagination and sorting
   * @param {boolean} [useCache=false] - Whether to use cached data
   * @returns {Object} Status and array of related records with detailed logs
   */
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
        throw new Error(`Table "${tableName}" not found`);
      } else {
        console.log(`Table found: ${sheet.getName()}`);
      }

      if (!this.tables[tableName][field]) {
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
        console.log("queried column: ", headers[fieldIndex]);
        relatedData = sheet
          .getRange(2, 1, sheet.getLastRow(), sheet.getLastColumn())
          .getValues();
        let finalData = [];
        for (let i = 0; i < relatedData.length; i++) {
          let row = relatedData[i];
          let obj = {};
          if (row[fieldIndex] === foreignKey) {
            // console.log("row que si paso", row)
            for (let j = 0; j < headers.length; j++) {
              let header = headers[j].toLowerCase();
              obj[header] = row[j];
            }
            finalData.push(obj);
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
        let fieldType = this.tables[tableName][sortField];
        if (fieldType && fieldType.hasOwnProperty("type"))
          fieldType = fieldType.type;
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

  /**
   * Gets related records using text finder
   * @param {number} foreignKey - Foreign key to search for
   * @param {string} tableName - Name of the table to search in
   * @param {string} field - Field name containing the foreign key
   * @param {number} fieldIndex - Index of the field in the table
   * @param {Object} [options={}] - Options for pagination and sorting
   * @param {boolean} [useCache=false] - Whether to use cached data
   * @returns {Object} Status and array of related records found using text finder
   */
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

        const searchColumnRange = sheet.getRange(
          2,
          fieldIndex + 1,
          lastRow - 1,
          1
        );
        const textFinder = searchColumnRange
          .createTextFinder(foreignKey.toString())
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
        let fieldType = this.tables[tableName][sortField];
        if (fieldType && fieldType.hasOwnProperty("type"))
          fieldType = fieldType.type;
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

  /**
   * MANY TO MANY LOGIC (create stays the same)
   */

  updateJunctionRecord(junctionTableName, id, data, keyOrder) {
    try {
      // Validate required parameters
      if (!id) {
        throw new Error("ID parameter is required for updateJunctionRecord");
      }

      const table = this._getSheet(junctionTableName);
      if (!table) {
        throw new Error(`Junction table '${junctionTableName}' not found.`);
      }
      const headers = this._getHeaders(table);
      if (!headers || !headers.length) {
        throw new Error(
          `Could not retrieve headers for table '${junctionTableName}'`
        );
      }

      // Validate we have exactly two foreign keys
      const checkDimension =
        Object.keys(data).filter((key) => !key.includes("_id")).length === 2;
      if (!checkDimension) {
        throw new Error(
          "Junction table must have exactly two foreign key fields"
        );
      }

      // Get foreign key field names and their indices
      let entityTableNames = keyOrder.filter((item) => item.endsWith("_id"));

      console.log("entity table names no cleaning:", entityTableNames);

      const entityFkIndices = entityTableNames.map((fieldName) =>
        headers.indexOf(fieldName.toUpperCase())
      );
      console.log("fk column indices:", entityFkIndices);

      // Validate all foreign key columns were found
      if (entityFkIndices.includes(-1)) {
        throw new Error("One or more foreign key columns not found in headers");
      }

      // Clean table names by removing _id suffix
      entityTableNames = entityTableNames.map((item) =>
        item.replace(/_id$/, "")
      );
      console.log("entity table names:", entityTableNames);

      // Collect and validate foreign keys
      const fksIds = [];
      for (const tableName of entityTableNames) {
        const id_field = `${tableName}_id`;
        const recordId = data[id_field];
        fksIds.push(recordId);

        const response = this.read(tableName.toUpperCase(), recordId);
        if (response.status === 500) {
          throw new Error(
            `Record with ID ${recordId} not found in table ${tableName}. read() error: ${response.error}`
          );
        }
      }

      // Get all existing foreign key combinations, excluding the current record being updated
      const lastRow = table.getLastRow() === 1 ? 2 : table.getLastRow();

      // Find the row index of the current record being updated
      const currentRecordRow = this._findRowById(table, id);
      if (currentRecordRow === -1) {
        throw new Error(
          `Record with ID ${id} not found in junction table ${junctionTableName}`
        );
      }

      const existingRecords = [];
      entityFkIndices.forEach((colIndex) => {
        // Get values from rows 2 to lastRow, excluding the current record row
        const values = [];
        for (let row = 2; row <= lastRow; row++) {
          if (row !== currentRecordRow) {
            values.push(table.getRange(row, colIndex + 1).getValue());
          }
        }
        existingRecords.push(values);
      });

      console.log("existing records (excluding current):", existingRecords);
      console.log("existing records length:", existingRecords[0]?.length || 0);
      console.log("fks length:", fksIds.length);
      console.log("current record row:", currentRecordRow);

      let isDuplicate = false;

      // Only check for duplicates if there are existing records to compare against
      if (existingRecords[0] && existingRecords[0].length > 0) {
        for (let i = 0; i < existingRecords[0].length && !isDuplicate; i++) {
          let isMatch = true;
          for (let j = 0; j < existingRecords.length && isMatch; j++) {
            if (existingRecords[j][i] !== fksIds[j]) {
              isMatch = false;
            }
          }
          if (isMatch) {
            isDuplicate = true;
          }
        }
      }

      if (isDuplicate) {
        throw new Error(
          `Duplicate relationship found for keys: ${fksIds.join(
            ", "
          )} in another record`
        );
      }
      // Prepare final data with timestamp
      const enrichedData = {
        created_at: new Date(),
        ...data,
      };

      return this.update(junctionTableName, id, enrichedData, keyOrder);
    } catch (err) {
      console.error("Error updating junction record", err.stack);
      const isValidationError =
        err.message.includes("ID parameter is required") ||
        err.message.includes("must have exactly two") ||
        err.message.includes("not found in headers") ||
        err.message.includes("Type mismatch") ||
        err.message.includes("Missing required fields") ||
        err.message.includes("Incomplete keyOrder") ||
        err.message.includes("Record with ID");
      return {
        status: err.message.includes("Record with ID")
          ? 404
          : isValidationError
          ? 400
          : 500,
        error: {
          message: err.message,
          stackTrace: err.stack,
        },
      };
    }
  }

  _getHeaders(sheet) {
    const rawHeaders = sheet
      .getRange(1, 1, 1, sheet.getLastColumn())
      .getValues()[0];
    // Ensure all headers are strings to prevent issues with .toLowerCase(), .endsWith(), etc.
    return rawHeaders.map((header) => String(header));
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
    console.log("next id", nextId);
    if (isNaN(nextId)) {
      throw new Error(
        "Next ID is not a number, please check the ID column in the sheet"
      );
    }
    return nextId;
  }

  _getCachedData(key) {
    const cached = this.cache.get(key);
    return cached ? JSON.parse(cached) : null;
  }

  _setCachedData(key, data) {
    console.log(
      "[CACHE] trying to cache",
      data.length,
      " records in",
      key,
      "key"
    );
    try {
      this.cache.put(key, JSON.stringify(data), 600);
    } catch (e) {
      console.log(
        "[CACHE] tried to cache",
        data.length,
        " records in",
        key,
        "key, but got the error: ",
        e.message
      );
      console.log("[WARNING] NO CACHE SET FOR ", key, " key");
    }
  }

  _clearCache(tableName) {
    this.cache.remove(`${tableName}_all`);
  }

  /**
   * Handles cascade deletion of related records
   * @private
   * @param {string} tableName - Name of the parent table
   * @param {number} id - ID of the record being deleted
   * @returns {Object} Status and count of deleted related records
   */
  _handleCascadeDelete(tableName, id) {
    try {
      const sheets = this.spreadsheet.getSheets();
      const tableBaseName = tableName.toLowerCase();

      let deletedRelations = 0; // Track number of affected records
      for (const sheet of sheets) {
        const sheetName = sheet.getName();
        if (!sheetName.includes("DELETED") && sheetName.includes("RELATION")) {
          const junctionTableName = sheetName;
          const junctionHistoryTableName = `DELETED_${sheetName}`;
          const headers = this._getHeaders(sheet);
          const fkFieldName = `${tableBaseName}_id`;

          const fkIndex = headers.indexOf(fkFieldName.toUpperCase());

          if (fkIndex !== -1) {
            const response = this.deleteRelatedJunctionRecords(
              junctionTableName,
              junctionHistoryTableName,
              fkIndex,
              id
            );
            if (response.status === 200) {
              deletedRelations += response.count;
            }
          }
        }
      }
      return {
        status: 200,
        message: `Cascade delete completed. Removed ${deletedRelations} related records`,
      };
    } catch (err) {
      console.error("Cascade delete failed:", err);
      throw err; // Propagate error to main delete operation
    }
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
   * Validates that keyOrder includes all required fields from table schema
   * @param {string} tableName - Name of the table
   * @param {string[]} keyOrder - Array of field names provided
   * @returns {Object} - Validation result with missing required fields
   */
  _validateKeyOrderCompleteness(tableName, keyOrder) {
    const tableSchema = this.tables[tableName];
    if (!tableSchema) {
      return { isValid: true, missingRequiredFields: [] }; // No schema to validate against
    }

    const requiredFields = [];
    for (const [fieldName, fieldDef] of Object.entries(tableSchema)) {
      const hasDefault =
        this._getDefaultValue(tableName, fieldName) !== undefined;
      if (!hasDefault) {
        requiredFields.push(fieldName);
      }
    }

    const missingRequiredFields = requiredFields.filter(
      (field) => !keyOrder.includes(field)
    );
    const isValid = missingRequiredFields.length === 0;

    return { isValid, missingRequiredFields, requiredFields };
  }

  /**
   * Validates that all required keys are present in the data object.
   * @param {Object} data - The data object to validate.
   * @param {string[]} keyOrder - An array of required keys.
   * @param {string} [context] - Optional context for error messages.
   * @returns {Object} - An object containing validation status and missing keys.
   */
  _validateData(tableName, data, keyOrder, context = "") {
    // First validate that keyOrder is complete
    const keyOrderValidation = this._validateKeyOrderCompleteness(
      tableName,
      keyOrder
    );
    if (!keyOrderValidation.isValid) {
      throw new Error(
        `Incomplete keyOrder: Missing required fields [${keyOrderValidation.missingRequiredFields.join(
          ", "
        )}] ${context}. Required fields are: [${keyOrderValidation.requiredFields.join(
          ", "
        )}]`
      );
    }

    // Then validate that data contains all keys from keyOrder
    const missingKeys = keyOrder.filter((key) => {
      const isMissing = !(key in data);
      if (!isMissing) return false;
      const defaultValue = this._getDefaultValue(tableName, key);
      return defaultValue ? false : true; // only flag missing if no default
    });
    const isValid = missingKeys.length === 0;
    return { isValid, missingKeys, context };
  }

  _checkType(value, expectedType) {
    expectedType = expectedType.trim();
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

  /**
   * Normalize incoming schema field definitions to { type, default? }
   * @param {Object} fields
   * @returns {Object}
   */
  _normalizeSchemaFields(fields) {
    const normalized = {};
    const VALID_TYPES = ["string", "number", "boolean", "date"];
    const validTypesList = VALID_TYPES.join(", ");
    for (const [fieldName, definition] of Object.entries(fields || {})) {
      if (typeof definition === "string") {
        const typeValue = definition.trim();
        if (!VALID_TYPES.includes(typeValue)) {
          throw new Error(
            `Invalid type "${typeValue}" for field "${fieldName}". Valid types are: ${validTypesList}`
          );
        }
        normalized[fieldName] = { type: typeValue };
      } else if (definition && typeof definition === "object") {
        const typeValue =
          typeof definition.type === "string" ? definition.type.trim() : "";
        if (!typeValue) {
          throw new Error(
            `Missing required 'type' for field "${fieldName}". Valid types are: ${validTypesList}`
          );
        }
        if (!VALID_TYPES.includes(typeValue)) {
          throw new Error(
            `Invalid type "${typeValue}" for field "${fieldName}". Valid types are: ${validTypesList}`
          );
        }
        const norm = { type: typeValue };
        if (Object.prototype.hasOwnProperty.call(definition, "default")) {
          norm.default = definition.default;
        }
        // Optional behavior flags
        if (
          Object.prototype.hasOwnProperty.call(definition, "treatNullAsMissing")
        ) {
          if (typeof definition.treatNullAsMissing !== "boolean") {
            throw new Error(
              `Invalid value for 'treatNullAsMissing' on field "${fieldName}". Expected boolean.`
            );
          }
          norm.treatNullAsMissing = definition.treatNullAsMissing;
        }
        if (
          Object.prototype.hasOwnProperty.call(
            definition,
            "treatEmptyStringAsMissing"
          )
        ) {
          if (typeof definition.treatEmptyStringAsMissing !== "boolean") {
            throw new Error(
              `Invalid value for 'treatEmptyStringAsMissing' on field "${fieldName}". Expected boolean.`
            );
          }
          norm.treatEmptyStringAsMissing = definition.treatEmptyStringAsMissing;
        }
        normalized[fieldName] = norm;
      } else {
        throw new Error(
          `Invalid schema definition for field "${fieldName}". Expected string or { type, default? }`
        );
      }
    }
    return normalized;
  }

  _getFieldDefinition(tableName, key) {
    const tableDef = this.tables?.[tableName];
    if (!tableDef) return null;
    const def = tableDef[key];
    if (def == null) return null;
    if (typeof def === "string") return { type: def.trim() };
    if (typeof def === "object") return def;
    return null;
  }

  _getExpectedType(tableName, key) {
    const def = this._getFieldDefinition(tableName, key);
    return def?.type || null;
  }

  _getDefaultValue(tableName, key) {
    const def = this._getFieldDefinition(tableName, key);
    if (!def || !Object.prototype.hasOwnProperty.call(def, "default")) {
      return undefined;
    }

    const defaultValue = def.default;

    // Handle special default values
    if (defaultValue === "now") {
      return new Date();
    }

    return defaultValue;
  }

  /**
   * Apply default values to missing fields (undefined only).
   * Does not override explicit null or empty string values.
   * @param {string} tableName
   * @param {Object} data
   * @param {string[]} keyOrder
   * @returns {{ data: Object, appliedDefaults: Array<{key: string, value: any}> }}
   */
  _applyDefaults(tableName, data, keyOrder) {
    const result = { ...data };
    const appliedDefaults = [];
    for (const key of keyOrder) {
      const currentValue = result[key];
      const fieldDef = this._getFieldDefinition(tableName, key) || {};
      const treatNullAsMissing = !!fieldDef.treatNullAsMissing;
      const treatEmptyStringAsMissing = !!fieldDef.treatEmptyStringAsMissing;

      const isConsideredMissing =
        currentValue === undefined ||
        (currentValue === null && treatNullAsMissing) ||
        (currentValue === "" && treatEmptyStringAsMissing);

      if (isConsideredMissing) {
        const defVal = this._getDefaultValue(tableName, key);
        if (defVal !== undefined) {
          // Coalesce null defaults to empty string to preserve prior blank behavior
          result[key] = defVal === null ? "" : defVal;
          appliedDefaults.push({ key, value: defVal });
        }
      }
    }
    return { data: result, appliedDefaults };
  }

  /**
   * Validates type checking with detailed logging
   * @private
   * @param {*} value - Value to check
   * @param {string} expectedType - Expected type of the value
   * @returns {boolean} Whether the value matches the expected type
   */
  _checkTypeWithLogs(value, expectedType) {
    console.log("\n[TYPE CHECK] Starting type check:", {
      value,
      expectedType,
      actualType: typeof value,
      isNull: value === null,
      isUndefined: value === undefined,
    });

    switch (expectedType) {
      case "number":
        const isNumber = typeof value === "number" && !isNaN(value);
        console.log("[NUMBER CHECK]", {
          value,
          isTypeNumber: typeof value === "number",
          isNotNaN: !isNaN(value),
          finalResult: isNumber,
        });
        return isNumber;

      case "string":
        const isString = typeof value === "string";
        console.log("[STRING CHECK]", {
          value,
          isTypeString: isString,
          valueLength: value?.length,
        });
        return isString;

      case "boolean":
        const isBoolean = typeof value === "boolean";
        console.log("[BOOLEAN CHECK]", {
          value,
          isTypeBoolean: isBoolean,
          isTruthy: !!value,
        });
        return isBoolean;

      case "date":
        try {
          console.log("[DATE CHECK] Initial value:", {
            value,
            isDate: value instanceof Date,
            prototype: Object.prototype.toString.call(value),
          });

          // Check if it's a Date object
          const isDateObject =
            Object.prototype.toString.call(value) === "[object Date]";
          console.log("[DATE CHECK] Is Date object:", isDateObject);

          // Try to get timestamp (will throw if not a valid date)
          let hasValidTimestamp = false;
          try {
            hasValidTimestamp = !isNaN(value.getTime());
            console.log("[DATE CHECK] Timestamp check:", {
              timestamp: value.getTime(),
              isValid: hasValidTimestamp,
            });
          } catch (e) {
            console.error("[DATE CHECK] Failed to get timestamp:", e.message);
          }

          const isValidDate = isDateObject && hasValidTimestamp;
          console.log("[DATE CHECK] Final result:", {
            isDateObject,
            hasValidTimestamp,
            isValid: isValidDate,
          });

          return isValidDate;
        } catch (err) {
          console.error("[DATE CHECK] Error during date validation:", {
            error: err.message,
            stack: err.stack,
          });
          return false;
        }

      default:
        console.warn("[TYPE CHECK] Unknown type:", expectedType);
        return false;
    }
  }

  _checkValidCreationTypes(tableFields) {
    const VALID_TYPES = ["string", "number", "boolean", "date"];
    const validTypes = VALID_TYPES.join(", ");
    if (tableFields) {
      for (const [field, type] of Object.entries(tableFields)) {
        if (!VALID_TYPES.includes(type)) {
          throw new Error(
            `Invalid type "${type}" for field "${field}". Valid types are: ${validTypes}`
          );
        }
      }
    }
  }

  _getFieldIndex(tableName, fieldName) {
    const table = this._getSheet(tableName);
    if (!table) {
      throw new Error(`Table '${tableName}' not found`);
    }

    const headers = this._getHeaders(table);
    const fieldIndex = headers.findIndex(
      (header) => header.toLowerCase() === fieldName.toLowerCase()
    );

    return fieldIndex;
  }

  applyColorScheme(tableName, colorScheme) {
    try {
      const sheet = this.spreadsheet.getSheetByName(tableName);
      const lastRow = sheet.getLastRow() === 1 ? 10 : sheet.getLastRow();

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

      const sampleFromApplyColorScheme = {
        headerColor: scheme.headerColor,
        color1: scheme.color1,
        color2: scheme.color2,
      };

      // Apply alternating colors to the data rows
      for (let row = 2; row <= lastRow; row++) {
        const range = sheet.getRange(row, 1, 1, lastCol);
        if (row % 2 === 0) {
          range.setBackground(scheme.color2); // Even rows
        } else {
          range.setBackground(scheme.color1); // Odd rows
        }
      }

      console.log("sampleFromApplyColorScheme", sampleFromApplyColorScheme);
      return {
        status: 200,
        message: `Color scheme applied to table ${tableName}`,
        data: sampleFromApplyColorScheme,
      };
    } catch (error) {
      console.error("[APPLY COLOR SCHEME] Error:", error);
      return {
        status: 500,
        message: `Error applying color scheme to table ${tableName}, ${error}`,
        data: {},
      };
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
      position: "QA Engineer",
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

  console.log(
    db.createManyToManyTableConfig({
      tableName: "TOOL_GROUP_RELATION",
      historyTableName: "DELETED_TOOL_GROUP_RELATION",
      entity1TableName: "TOOL",
      entity2TableName: "MINOR_TOOL_GROUP_MIGRATION",
    })
  );
}
