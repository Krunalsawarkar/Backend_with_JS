import { asyncHandler } from "../utils/asyncHandler.js";
import { apiError } from "../utils/apiError.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { apiResponse } from "../utils/apiResponse.js";
import jwt from "jsonwebtoken";

const generateAccessAndRefreshTokens = async (userId) => {
  try {
    const user = await User.findById(userId);
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });
    return { accessToken, refreshToken };
  } catch (error) {
    throw new apiError(
      500,
      "Something went wrong while generating both tokens!!"
    );
  }
};

const registerUser = asyncHandler(async (req, res) => {
  // get user details from frontend
  // validation - not empty
  // check if user already exists: username, email
  // check for images, check for avatar
  // upload them to cloudinary, avatar
  // create user object - create entry in db
  // remove password and refresh token field from response
  // check for user creation
  // return res

  const { fullname, email, username, password } = req.body;
  //console.log("email: ", email);

  if (
    [fullname, email, username, password].some((field) => field?.trim() === "")
  ) {
    throw new apiError(400, "All fields are required");
  }

  const existedUser = await User.findOne({
    $or: [{ username }, { email }],
  });

  if (existedUser) {
    throw new apiError(409, "User with email or username already exists");
  }
  console.log(req.files);

  const avatarLocalPath = req.files?.["avatar"]?.[0]?.path;
  const coverImageLocalPath = req.files?.["coverImage"]?.[0]?.path;

  if (!avatarLocalPath) {
    throw new apiError(400, "Avatar file is required");
  }

  const avatar = await uploadOnCloudinary(avatarLocalPath);
  const coverImage = await uploadOnCloudinary(coverImageLocalPath);
  if (!avatar) {
    throw new apiError(400, "Avatar file is required");
  }

  const user = await User.create({
    fullname,
    avatar: avatar.url,
    coverImage: coverImage?.url || "",
    email,
    password,
    username: username.toLowerCase(),
  });

  const createdUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );

  if (!createdUser) {
    throw new apiError(500, "Something went wrong while registering the user");
  }

  return res
    .status(201)
    .json(new apiResponse(200, createdUser, "User registered Successfully"));
});

const loginUser = asyncHandler(async (req, res) => {
  //req.body --> data
  const { email, username, password } = req.body;

  //validate username or password
  if (!(username || email)) {
    throw new apiError(400, "Username and Email is required!!");
  }

  //find the user
  const user = await User.findOne({
    $or: [{ username }, { email }],
  });

  if (!user) {
    throw new apiError(404, "User does not exists!!");
  }

  //pass check
  const validPass = await user.isPasswordCorrect(password);
  if (!validPass) {
    throw new apiError(401, "Invalid Credentials!!");
  }

  //access and refresh token
  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(
    user._id
  );

  //send cookies

  const loggedInUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );

  const option = {
    httpOnly: true,
    secure: true,
  };

  return res
    .status(200)
    .cookie("accessToken", accessToken, option)
    .cookie("refreshToken", refreshToken, option)
    .json(
      new apiResponse(
        200,
        { user: loggedInUser, accessToken, refreshToken },
        "User Logged in Sucessfully!!"
      )
    );
});

const logoutUser = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(
    req.user._id,
    {
      $set: { refreshToken: undefined },
    },
    { new: true }
  );

  const option = {
    httpOnly: true,
    secure: true,
  };

  return res
    .status(200)
    .clearCookie("accessToken", option)
    .clearCookie("refreshToken", option)
    .json(new apiResponse(200, {}, "User Logged Out!!"));
});

const refreshAccessToken = asyncHandler(async (req, res) => {
  const reqRefreshToken = req.cookies.refreshToken || req.body.refreshToken;

  if (!reqRefreshToken) {
    throw new apiError(401, "Unauthorized Request");
  }

  try {
    const decodeToken = jwt.verify(
      reqRefreshToken,
      process.env.REFRESH_TOKEN_SECRET
    );

    const user = await User.findById(decodeToken?._id);

    if (!user) {
      throw new apiError(401, "Invalid Refresh Token");
    }

    if (reqRefreshToken !== user?.refreshToken) {
      throw new apiError(401, "Refresh Token Expired!!");
    }

    const option = {
      httpOnly: true,
      secure: true,
    };

    const { accessToken, NewRefreshToken } =
      await generateAccessAndRefreshTokens(user._id);

    return res
      .status(200)
      .cookie("accessToken", accessToken, option)
      .cookie("refreshToken", NewRefreshToken, option)
      .json(
        new apiResponse(
          200,
          { accessToken, refreshToken: NewRefreshToken },
          "Access Token Refreshed!!"
        )
      );
  } catch (error) {
    throw new apiError(401, errpr?.message || "Invalid Refresh Token");
  }
});

const changeCurrentPassword = asyncHandler(async (req, res) => {
  const { oldPass, newPass } = req.body;
  const user = await User.findById(req.user?._id);
  const isPassCorrect = await user.isPasswordCorrect(oldPass);

  if (!isPassCorrect) {
    throw new apiError(401, "Invalid Password!!");
  }

  user.password = newPass;
  await user.save({ validateBeforeSave: false });

  return res
    .status(200)
    .json(new apiResponse(200, {}, "Password Chnaged Successfully!"));
});

const getCurrentUser = asyncHandler(async (req, res) => {
  return res
    .status(200)
    .json(200, req.user, "Current User Fetched Succssfully!!");
});

const updateAccDetails = asyncHandler(async (req, res) => {
  const { fullname, email } = req.body;
  if (!(fullname || email)) {
    throw new apiError(400, "All fields are Required");
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        fullname,
        email,
      },
    },
    { new: true }
  ).select("-password");

  return res
    .status(200)
    .json(new apiResponse(200, user, "Account Details Updated Successfully!!"));
});

const updateUserAvatar = asyncHandler(async (req, res) => {
  const avatarLocalPath = req.file?.path;
  if (!avatarLocalPath) {
    throw new apiError(400, "Avatar File is Missing!!");
  }
  const avatar = await uploadOnCloudinary(avatarLocalPath);

  if (!avatar) {
    throw new apiError(400, "Error while uploading Avatar");
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        avatar: avatar.url,
      },
    },
    { new: true }
  ).select("-password");
  return res
    .status(200)
    .json(new apiResponse(200, user, "Avatar Image Updated Successfully!!"));
});

const updateUserCoverImg = asyncHandler(async (req, res) => {
  const coverLocalPath = req.file?.path;
  if (!coverLocalPath) {
    throw new apiError(400, "Cover Img File is Missing!!");
  }
  const coverImg = await uploadOnCloudinary(coverLocalPath);

  if (!coverImg) {
    throw new apiError(400, "Error while uploading Cover Image");
  }

  await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        coverImage: coverImg.url,
      },
    },
    { new: true }
  ).select("-password");

  return res
    .status(200)
    .json(new apiResponse(200, user, "Cover Image Updated Successfully!!"));
});

const getUserChannelProfile = asyncHandler(async (req, res) => {
  const { username } = req.params;
  if (!username?.trim()) {
    throw new apiError(400, "username is missing");
  }
  const channel = await User.aggregate([
    {
      $match: {
        username: username?.toLowerCase(),
      },
    },
    {
      $lookup: {
        from: "$subscription",
        localField: "_id",
        foreignField: "channel",
        as: "subscribers",
      },
    },
    {
      $lookup: {
        from: "$subscription",
        localField: "_id",
        foreignField: "subscriber",
        as: "subscribedTo",
      },
    },
    {
      $addFields: {
        subscribersCount: {
          $size: "$subscribers",
        },
        channelsCount: {
          $size: "$subscribedTo",
        },
        isSubscribed: {
          $cond: {
            if: { $in: [req.user?._id, "$subscibers.subscriber"] },
            then: true,
            else: false,
          },
        },
      },
    },
    {
      $project: {
        fullname: 1,
        username: 1,
        subscribersCount: 1,
        channelsCount: 1,
        isSubscribed: 1,
        avatar: 1,
        coverImage: 1,
        email: 1,
      },
    },
  ]);

  if (!channel?.length) {
    throw new apiError(400, "Channel does not exists");
  }

  return res
    .status(200)
    .json(
      new apiResponse(200, channel[0], "User Channel Fetched Successfully")
    );
});

export {
  registerUser,
  loginUser,
  logoutUser,
  refreshAccessToken,
  changeCurrentPassword,
  getCurrentUser,
  updateAccDetails,
  updateUserAvatar,
  updateUserCoverImg,
  getUserChannelProfile,
};
