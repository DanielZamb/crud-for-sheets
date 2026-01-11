# Optimistic Concurrency Control Implementation for GSDB

## Overview

This document summarizes the implementation of Optimistic Concurrency Control (OCC) for the Google Apps Script Database (GSDB) library using version fields and Compare-And-Swap (CAS) operations.

## Implementation Summary

### Core Changes to CrudForSheets.js

#### 1. Table Schema Enhancement
- Added `enableVersioning` parameter to `createTable()` method
- Added `enableVersioning` parameter to `putTableIntoDbContext()` method
- Tables with versioning enabled automatically get a `VERSION` column after the `DATE` column
- Version information is stored in the table schema metadata (`_enableVersioning`)

#### 2. Helper Methods
Added private helper methods for version management:
- `_isVersioningEnabled(tableName)`: Checks if versioning is enabled for a table
- `_getVersionColumnIndex(sheet)`: Gets the column index of the VERSION field
- `_getCurrentVersion(sheet, rowIndex)`: Retrieves the current version of a record
- `_setVersion(sheet, rowIndex, version)`: Sets the version for a record

#### 3. Create Method Updates
- Modified `create()` to initialize version to 1 when versioning is enabled
- Modified `createWithLogs()` to support versioning
- Returns `version: 1` in the response when versioning is enabled

#### 4. Update Method Updates
- Added `expectedVersion` parameter to `update()` method (7th parameter)
- Implements Compare-And-Swap (CAS) logic:
  - Reads current version from the record
  - If `expectedVersion` is provided, compares it with current version
  - Throws error if versions don't match (conflict detected)
  - Increments version on successful update
- Returns new version number in response when versioning is enabled
- Error message: "Optimistic concurrency conflict: Record has been modified. Expected version X, but current version is Y"

#### 5. Read Method Updates
- Modified `read()` to include version in returned data when versioning is enabled
- Adds `_versioningEnabled` flag to response metadata
- Version is automatically included in the `data` object as `data.version`

### Documentation

#### 1. Comprehensive Guide (`docs/optimistic-concurrency.mdx`)
Created a complete guide covering:
- What is Optimistic Concurrency Control
- How it works (Read → Modify → Update → Compare-And-Swap)
- Enabling versioning for new and existing tables
- Basic usage examples
- Handling conflicts
- Conflict resolution strategies:
  - Retry pattern with exponential backoff
  - User notification
  - Merge strategy
- Real-world example: Inventory management
- Best practices
- When to use OCC vs existing locks
- Troubleshooting guide
- Migration guide for existing tables
- API reference

#### 2. Code Examples (`examples/optimistic-concurrency-example.js`)
Created comprehensive examples demonstrating:
- Example 1: Basic version check
- Example 2: Retry pattern with exponential backoff
- Example 3: Inventory management with conflict resolution
- Example 4: Order processing with atomic stock updates
- Example 5: Merge strategy for non-conflicting changes
- Example 6: Monitoring and metrics
- Example 7: Migration helper for existing tables

Includes reusable utility functions:
- `updateWithRetry()`: Automatic retry with exponential backoff
- `decrementStock()`: Safe stock decrement with OCC
- `processOrder()`: Complete order processing workflow
- `mergeUpdate()`: Intelligent merge of non-conflicting changes
- `updateWithMetrics()`: Update with performance tracking
- `addVersioningToExistingTable()`: Migration helper

#### 3. API Reference Updates (`docs/api-reference.mdx`)
Updated documentation for:
- `createTable()`: Added `enableVersioning` parameter
- `putTableIntoDbContext()`: Added `enableVersioning` parameter
- `read()`: Documented version field in response
- `update()`: Added `expectedVersion` parameter with examples

#### 4. README Updates (`README.md`)
- Added Optimistic Concurrency Control to features list
- Added "What's New in v1.1.0" section highlighting OCC

#### 5. Documentation Navigation (`docs.json`)
- Added "Optimistic Concurrency" page to sidebar under Advanced Examples

## Usage Examples

### Enabling Versioning

```javascript
// For new tables
db.createTable({
  tableName: 'PRODUCTS',
  enableVersioning: true,
  fields: { name: 'string', price: 'number', stock: 'number' }
});

// For existing tables in schema
db.putTableIntoDbContext({
  tableName: 'PRODUCTS',
  enableVersioning: true,
  fields: { name: 'string', price: 'number', stock: 'number' }
});
```

### Basic Update with Version Check

```javascript
// Read with version
const readResult = db.read('PRODUCTS', 123);
const product = readResult.data;
const currentVersion = product.version;

// Update with version check
const updateResult = db.update(
  'PRODUCTS',
  123,
  { name: product.name, price: 99.99, stock: product.stock },
  ['name', 'price', 'stock'],
  false,
  null,
  currentVersion  // Compare-And-Swap
);

if (updateResult.error?.includes('Optimistic concurrency conflict')) {
  // Handle conflict
}
```

### Retry Pattern

```javascript
function updateWithRetry(db, tableName, id, updateFn, keyOrder, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const readResult = db.read(tableName, id);
    const currentData = readResult.data;
    const currentVersion = currentData.version;
    
    const updatedData = updateFn(currentData);
    
    const updateResult = db.update(
      tableName, id, updatedData, keyOrder,
      false, null, currentVersion
    );
    
    if (updateResult.status === 200) {
      return { success: true, data: updateResult };
    }
    
    if (updateResult.error?.includes('Optimistic concurrency conflict')) {
      const delay = 100 * Math.pow(2, attempt);
      Utilities.sleep(delay);
      continue;
    }
    
    return { success: false, error: updateResult.error };
  }
  
  return { success: false, error: 'Max retries exceeded' };
}
```

## Key Features

### 1. Non-Breaking Changes
- Versioning is opt-in via `enableVersioning` parameter
- Existing code continues to work without modifications
- `expectedVersion` parameter is optional in `update()`

### 2. Automatic Version Management
- Version initialized to 1 on record creation
- Version automatically incremented on each update
- Version included in read responses when enabled

### 3. Clear Error Messages
- Conflict errors clearly indicate version mismatch
- Error message includes expected and current versions
- Easy to detect and handle conflicts

### 4. Flexible Conflict Resolution
- Supports multiple strategies: retry, notify, merge
- Examples provided for common patterns
- Exponential backoff recommended for retries

### 5. Performance Considerations
- No performance impact when versioning is disabled
- Version check happens within existing write lock
- Minimal overhead (single column read/write)

## Comparison with Existing Locks

| Feature | Existing Locks | Optimistic Concurrency |
|---------|---------------|----------------------|
| Lock Type | Pessimistic (Script/User lock) | Optimistic (Version check) |
| When Locked | During read/write | Only during write |
| Conflict Detection | Prevents concurrent access | Detects at write time |
| Performance | Can block operations | Better for read-heavy workloads |
| Use Case | Short critical sections | Long-running user interactions |
| Timeout | 100ms (write), 30s (read) | No timeout, immediate check |

**Recommendation**: Use both together:
- Existing locks prevent corruption within a single operation
- Optimistic concurrency prevents conflicts across operations

## Migration Guide

For existing tables without versioning:

1. Add VERSION column to sheet (after DATE column)
2. Initialize all existing records to version 1
3. Update schema with `enableVersioning: true`

```javascript
function addVersioningToExistingTable(tableName) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tableName);
  
  // Insert VERSION column after DATE (column 2)
  sheet.insertColumnAfter(2);
  sheet.getRange(1, 3).setValue('VERSION');
  
  // Initialize all existing records to version 1
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const versionData = Array(lastRow - 1).fill([1]);
    sheet.getRange(2, 3, lastRow - 1, 1).setValues(versionData);
  }
}
```

## Testing Recommendations

1. **Unit Tests**: Test version increment logic
2. **Conflict Tests**: Simulate concurrent updates
3. **Retry Tests**: Verify retry logic with exponential backoff
4. **Migration Tests**: Test adding versioning to existing tables
5. **Performance Tests**: Measure overhead of version checking

## Future Enhancements

Potential improvements for future versions:
1. Batch update with version checks
2. Version history tracking
3. Automatic conflict resolution strategies
4. Version-based rollback capabilities
5. Integration with existing lock mechanisms

## Files Modified

1. `/workspace/CrudForSheets.js` - Core implementation
2. `/workspace/README.md` - Feature announcement
3. `/workspace/docs/optimistic-concurrency.mdx` - Comprehensive guide
4. `/workspace/docs/api-reference.mdx` - API documentation
5. `/workspace/docs.json` - Navigation update
6. `/workspace/examples/optimistic-concurrency-example.js` - Code examples

## Implementation Status

✅ All tasks completed:
1. ✅ Add version field to table schema and createTable method
2. ✅ Implement version checking in update method (Compare-And-Swap)
3. ✅ Add version increment logic on successful updates
4. ✅ Create helper methods for version management
5. ✅ Add optimistic concurrency to create method with addUpdatePolicy
6. ✅ Update read methods to include version field
7. ✅ Create documentation for optimistic concurrency feature
8. ✅ Add code examples demonstrating optimistic concurrency
9. ✅ Update API reference documentation

## Conclusion

The Optimistic Concurrency Control implementation provides a robust, scalable solution for preventing lost updates in concurrent scenarios. It follows industry best practices, provides clear error messages, and includes comprehensive documentation and examples. The implementation is backward-compatible and can be adopted incrementally by enabling versioning on a per-table basis.
