const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    gender: {
      type: String,
      enum: ["Male", "Female"],
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
    },
    condition: {
      type: String,
      enum: ["new", "used"],
      required: true,
    },
    size: {
      type: String,
      required: true,
    },
    brand: {
      type: String,
      required: true,
    },
    material: {
      type: String,
      required: true,
    },
    color: {
      type: String,
    },
    isApproved: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: ["available", "sold", "pending", "reserved"],
      default: "available",
    },
    priceSuggestion: {
      minPrice: { type: Number },
      maxPrice: { type: Number },
      suggestedPrice: { type: Number },
      reason: { type: String },
      currency: { type: String },
      suggestedAt: { type: Date },
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Product", productSchema);
