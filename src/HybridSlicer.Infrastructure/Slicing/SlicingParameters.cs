// Extended parameters record used internally by the slicing infrastructure.
// The Application layer already declares SlicingParameters; this file
// adds the FirstLayerSpeedMmS and InfillSpeedMmS extension that the
// CuraEngineAdapter needs but wasn't in the original interface record.
// Resolution: update ISlicingEngine.SlicingParameters to include all fields.
// This file is intentionally left as a placeholder to note that the full
// CuraEngine config has >500 settings; the adapter starts with the most
// important and can be extended field-by-field without breaking the interface.
