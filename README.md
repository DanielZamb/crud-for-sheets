# Attention!!

Please refer to the Official Docs [here](https://docs.page/DanielZamb/crud-for-sheets) as they are being constantly updated. In the future this readme will only contain **instalation** and **new features summary**.

# 📊 Google Apps Script CRUD Class for Google Sheets (v1.0.0)

Welcome to the **Google Apps Script CRUD Class for Google Sheets**! This library simplifies managing your Google Sheets as databases, allowing you to perform **Create, Read, Update,** and **Delete** (CRUD) operations with ease. Whether you're building a CRM, inventory system, or any data-driven application, this library has got you covered! 🚀

![CRUD](https://img.icons8.com/color/96/000000/database.png)

## 🌟 Features

- **✨ CRUD Operations**: Seamlessly Create, Read, Update, and Delete records in Google Sheets.
- **📜 History Tracking**: Automatically track deletions with history tables.
- **🔍 Sorting & Pagination**: Easily sort and paginate your data for better management.
- **✅ Type Validation**: Ensure data integrity with type checking (`number`, `string`, `boolean`, `date`).
- **📦 **New** Concurrency Locks**: Prevent race conditions with built-in locking mechanisms for writes and reads.
- **🔐 **New** Optimistic Concurrency Control**: Prevent lost updates with version-based Compare-And-Swap (CAS) operations.
- **🔗 **New** Many-to-Many Relationship Support**: Handle complex data relationships using junction tables.
- **⚡️ Caching**: Improve performance with built-in caching mechanisms.
- **🎨 Customizable Color Schemes**: Beautify your sheets with predefined color themes.
- **🗃 **New** Bulk Reading**: Fetch multiple records by ID in a single call.

## 🎉 What's New in v1.1.0

1. **Optimistic Concurrency Control (OCC)**

- **Version-based locking** to prevent lost updates in concurrent scenarios.
- Enable versioning per table with `enableVersioning: true` in table config.
- New parameter in `update()`: `expectedVersion` for Compare-And-Swap (CAS) operations.
- Automatic version increment on successful updates.
- Perfect for inventory management, financial transactions, and collaborative editing.

## 🎉 What's New in v1.0.0

1. **Concurrency Locks**

- **Locking for Create/Update/Delete** operations to prevent concurrent writes on the same record.
- New methods:
  - `releaseLocks()`: Frees all active locks held by this instance.
- Automatically applied in `create`, `update`, and `remove`.

2. **Many-to-Many Relationship Support**

- Easily create and manage **junction tables**.
- New methods:
  - `createManyToManyTableConfig(config)`: Generates a ready-to-use table config for a junction (relation) table.
  - `createJunctionRecord(junctionTableName, data, keyOrder)`: Creates a new entry in the junction table.
  - `getJunctionRecords(junctionTableName, sourceTableName, targetTableName, sourceId, options)`: Returns related records from a junction.
  - `updateJunctionRecord(junctionTableName, id, data, keyOrder)`: Updates an existing record in the junction table.

3. **Cascade Deletion**

- `removeWithCascade(tableName, historyTableName, id)`: Removes a parent record and automatically deletes or archives the related records from associated junction tables.

4. **Bulk Read**

- `readIdList(tableName, ids)`: Allows you to read multiple records by their IDs in a single call.

5. **Integrity Checks**

- `checkTableIntegrity(junctionTableName, junctionHistoryTableName)`: Scans a junction table for invalid foreign key references and moves them to history if the parent records no longer exist.

6. **Enhanced Logging & Debug**

- Variants such as `createWithLogs()` and `updateWithLogs()` provide verbose logging to aid in debugging.

---

## 📦 Installation

1. **Open Google Apps Script Editor**:

   - Go to your Google Sheets.
   - Click on `Extensions` > `Apps Script`.

2. **Add the Library**:

   - In the Apps Script editor, click on the `+` icon next to `Libraries`.
   - Enter the Library ID: `1TJEgrBnjb_B8PVCnHstDzMmllYqR2dZuBVQUvprPYohST5uwPBuuxfcI`.
   - Select the latest version and add it to your project.

3. **Use the Library**:
   - You can now use the `DB` class from the library to manage your spreadsheets.
